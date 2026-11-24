// Run after building assets, with Miniflare and Playwright installed.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Miniflare } = require(process.env.CATALOG_MINIFLARE || 'miniflare');
const { chromium, devices } = require(process.env.CATALOG_PLAYWRIGHT || 'playwright');
const password = randomBytes(24).toString('base64url');
const mf = new Miniflare({
  host: '127.0.0.1',
  modules: true,
  scriptPath: 'worker/index.js',
  compatibilityDate: '2026-11-20',
  d1Databases: { DB: 'catalog-mvp-browser-isolated' },
  bindings: {
    ADMIN_USERNAME: 'test-owner',
    ADMIN_PASSWORD_HASH: 'v2.' + createHash('sha256').update(password).digest('base64url'),
    SESSION_SECRET: randomBytes(32).toString('hex'),
  },
  serviceBindings: {
    ASSETS: async request => {
      const pathname = new URL(request.url).pathname;
      const path = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
      const type = path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : 'text/javascript';
      try {
        return new Response(await readFile('site_dist' + path), { headers: { 'content-type': type + '; charset=utf-8' } });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    },
  },
});
let browser;
try {
  const origin = (await mf.ready).origin;
  const db = await mf.getD1Database('DB');
  for (const file of (await readdir('migrations')).sort()) {
    const sql = await readFile('migrations/' + file, 'utf8');
    await db.exec(sql.replace(/^--.*$/gm, '').split(';').map(statement => statement.trim().replace(/\s+/g, ' ')).filter(Boolean).join('\n'));
  }
  browser = await chromium.launch({ executablePath: process.env.CATALOG_CHROMIUM || undefined });
  const desktop = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const mobile = await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: 'chromium' });
  const admin = await mobile.newPage();
  const errors = [];
  admin.on('pageerror', error => errors.push(error.message));
  admin.on('dialog', dialog => dialog.accept());
  await admin.goto(origin + '/admin/');
  await admin.locator('#username').fill('test-owner');
  await admin.locator('#password').fill('wrong-password');
  await admin.locator('#loginForm [type=submit]').click();
  await admin.locator('#loginError').filter({ hasText: '帳號或密碼未通過雲端驗證' }).waitFor();
  await admin.locator('#password').fill(password);
  await admin.locator('#loginForm [type=submit]').click();
  await admin.locator('#appView').waitFor();
  const visitTab = async tab => {
    const item = admin.locator('[data-page="' + tab + '"]');
    if (await admin.locator('#menuBtn').isVisible()) await admin.locator('#menuBtn').click();
    await item.click();
  };
  await admin.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      // Safari can return PNG for a requested WebP encoding.
      const rejectWebP = type === 'image/webp' && document.querySelector('#photoProduct')?.value === '1';
      return toBlob.call(this, callback, rejectWebP ? 'image/png' : type, quality);
    };
  });
  const fixtures = await admin.evaluate(() => Array.from({ length: 5 }, (_, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = i % 2 ? 320 : 160;
    canvas.height = i % 2 ? 160 : 320;
    const context = canvas.getContext('2d');
    context.fillStyle = ['red', 'green', 'blue', 'orange', 'purple'][i];
    context.fillRect(0, 0, canvas.width, canvas.height);
    const type = i === 0 ? 'image/jpeg' : 'image/png';
    return { type, data: canvas.toDataURL(type).split(',')[1] };
  }));
  const assertPublicCount = async count => {
    const response = await desktop.request.get(origin + '/catalog/products.json');
    const products = await response.json();
    assert.equal(products.length, count);
    assert.ok(products.every(product => !('internal_note' in product)));
    return products;
  };
  assert.equal((await desktop.request.get(origin + '/api/admin/bootstrap')).status(), 401);
  for (let j = 0; j < 3; j++) {
    await visitTab('products');
    await admin.locator('[data-action=add]').click();
    await admin.locator('#fSku').fill('TEST-' + j);
    await admin.locator('#fName').fill('測試商品 ' + j);
    await admin.locator('#fNote').fill('測試私有備註');
    await admin.locator('[data-save]').click();
    await admin.waitForFunction(() => document.querySelector('#photoProduct')?.value);
    const files = fixtures.slice(0, j === 0 ? 5 : 4).map(({ data, type }, i) => ({
      name: 'fixture-' + i + (type === 'image/jpeg' ? '.jpg' : '.png'), mimeType: type, buffer: Buffer.from(data, 'base64'),
    }));
    if (j === 0) {
      // Commit the final upload but replace its response, then retry at the five-photo limit.
      await admin.route('**/api/admin/photos/upload', async route => {
        const body = route.request().postData() || '';
        const response = await route.fetch();
        if (body.includes('trial-4.jpg')) await route.fulfill({ status: 503, json: { error: '測試回應中斷' } });
        else await route.fulfill({ response });
      });
    }
    await admin.locator('#photoFiles').setInputFiles(files);
    await admin.locator('#photoUpload').click();
    if (j === 0) {
      await admin.locator('#photoUpload').filter({ hasText: '重新上傳' }).waitFor();
      await admin.locator('#photoList').filter({ hasText: '測試回應中斷' }).waitFor();
      await admin.unroute('**/api/admin/photos/upload');
      await admin.locator('#photoUpload').click();
    }
    await admin.locator('#photoStatus').filter({ hasText: '張照片已上傳完成' }).waitFor();
    await admin.waitForFunction(count => document.querySelectorAll('#existingPhotos img').length === count, files.length);
    if (j === 0) {
      const photos = admin.locator('#existingPhotos img');
      const newCover = await photos.nth(1).getAttribute('src');
      await admin.locator('#existingPhotos [data-move=up]').nth(1).click();
      await admin.waitForFunction(src => document.querySelector('#existingPhotos img')?.getAttribute('src') === src, newCover);
    }
    await assertPublicCount(0);
    await visitTab('products');
    const row = admin.locator('tr').filter({ hasText: 'TEST-' + j });
    await row.getByRole('button', { name: '編輯' }).click();
    await admin.locator('#fStatus').selectOption('active');
    await admin.locator('[data-save]').click();
    await admin.locator('#modal').waitFor({ state: 'hidden' });
    await row.filter({ hasText: '待發布上架' }).waitFor();
  }
  await visitTab('publish');
  // A missing D1 object must block preview without publishing any of the products.
  const object = await db.prepare("SELECT * FROM trial_image_objects WHERE object_key LIKE 'public/thumb/%' LIMIT 1").first();
  await db.prepare('DELETE FROM trial_image_objects WHERE object_key=?').bind(object.object_key).run();
  await admin.locator('#preparePublish').click();
  await admin.locator('#publishPreview').filter({ hasText: '儲存服務中不存在' }).waitFor();
  await assertPublicCount(0);
  await db.prepare('INSERT INTO trial_image_objects VALUES (?,?,?,?)').bind(object.object_key, object.content_type, object.size_bytes, new Uint8Array(object.data).buffer).run();
  await admin.locator('#preparePublish').click();
  const previews = admin.locator('#publishPreview img');
  await admin.waitForFunction(() => document.querySelectorAll('#publishPreview img').length === 13);
  const privatePath = await previews.first().getAttribute('src');
  assert.equal((await desktop.request.get(origin + privatePath)).status(), 401);
  assert.equal((await desktop.request.get(origin + privatePath.replace('/api/admin/publish/photo/', '/media/'))).status(), 404);
  await previews.first().scrollIntoViewIfNeeded();
  await admin.waitForFunction(() => document.querySelector('#publishPreview img')?.naturalWidth > 0);
  await assertPublicCount(0);
  await admin.locator('#confirmPublish').click();
  await admin.locator('#publishPreview').filter({ hasText: '發布成功' }).waitFor();
  const products = await assertPublicCount(3);
  assert.deepEqual(products.map(product => product.images.length), [5, 4, 4]);
  for (const [product, expectedType] of [[products[0], 'image/jpeg'], [products[1], 'image/webp']]) {
    for (const url of [product.images[0].src, product.images[0].thumb]) {
      const response = await desktop.request.get(origin + url);
      assert.equal(response.status(), 200);
      assert.equal(response.headers()['content-type'], expectedType);
    }
  }

  for (const [context, columns] of [[desktop, 3], [mobile, 2]]) {
    const guest = context === mobile ? await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: 'chromium' }) : desktop;
    const page = await guest.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/');
    await page.locator('#grid .item').first().waitFor();
    assert.equal(await page.locator('#grid').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length), columns);
    await page.locator('#q').fill('TEST-0');
    assert.equal(await page.locator('#grid .item').count(), 1);
    await page.locator('#grid .cover').click();
    await page.waitForFunction(() => document.querySelector('#large').naturalWidth > 0 && !document.querySelector('#large').hasAttribute('aria-busy'));
    assert.equal(await page.locator('#large').evaluate(img => img.naturalWidth / img.naturalHeight), 2);
    const navigationCount = await page.evaluate(() => performance.getEntriesByType('navigation').length);
    if (columns === 2) {
      await page.locator('#viewer').evaluate(viewer => {
        for (const [type, clientX] of [['touchstart', 250], ['touchend', 100]]) {
          const touch = new Touch({ identifier: 1, target: viewer, clientX, clientY: 100 });
          viewer.dispatchEvent(new TouchEvent(type, { changedTouches: [touch], bubbles: true }));
        }
      });
    } else {
      await page.locator('#next').click();
    }
    assert.equal(await page.locator('#position').textContent(), '2 / 5');
    assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation').length), navigationCount);
  }

  await visitTab('products');
  await admin.locator('tr').filter({ hasText: 'TEST-0' }).getByRole('button', { name: '編輯' }).click();
  await admin.locator('#fStatus').selectOption('archived');
  await admin.locator('[data-save]').click();
  await admin.locator('tr').filter({ hasText: '待發布下架' }).waitFor();
  await assertPublicCount(3);
  await visitTab('publish');
  await admin.locator('#preparePublish').click();
  await admin.locator('#confirmPublish').click();
  await admin.locator('#publishPreview').filter({ hasText: '發布成功' }).waitFor();
  await assertPublicCount(2);
  assert.equal((await desktop.request.get(origin + products[0].images[0].src)).status(), 404);
  const csv = await admin.evaluate(async () => {
    const response = await fetch('/api/admin/export.csv');
    return { status: response.status, text: await response.text() };
  });
  assert.equal(csv.status, 200);
  assert.match(csv.text, /TEST-0/);

  // Fill the accounting budget using isolated rows without allocating 200 MiB.
  await db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<400)
    INSERT INTO trial_image_objects SELECT 'test-quota-'||i,'image/webp',524288,X'01' FROM n`).run();
  await visitTab('photos');
  await admin.locator('#photoProduct').selectOption({ label: 'TEST-2　測試商品 2' });
  await admin.locator('#photoFiles').setInputFiles({
    name: 'quota.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(fixtures[0].data, 'base64'),
  });
  await admin.locator('#photoUpload').click();
  await admin.locator('#photoList').filter({ hasText: '200 MiB' }).waitFor();
  assert.equal(await admin.locator('#existingPhotos img').count(), 4);
  assert.deepEqual(errors, []);
  console.log('PASS local Worker/D1 + Chromium: login, 3 products/13 photos, upload retry, cover order, missing photo rejection, private preview, publication, 3/2 columns, click/swipe, archival, CSV, quota rejection');
} finally {
  await browser?.close();
  await mf.dispose();
}
