# 產品型錄網站 V1.2 — iPad／手機 Web 版

> **狀態：開發測試中，尚未完成部署及實機驗收。** 本專案目前使用 Cloudflare Workers + D1 測試版照片儲存，**沒有使用 R2**。原始照片在 iPad／手機端轉成壓縮 WebP 後才上傳，因此伺服器不保存相機原始檔。照片儲存上限為程式設置的約 200 MiB，單個影像物件不超過 512 KiB；這不代表免費方案一定可容納每季 800 張照片。

## 目前技術設定

- 管理端：iPad／iPhone 瀏覽器操作；公開端無須登入。
- Worker 設定：`wrangler.toml`；D1 binding 為 `DB`，資料庫名稱 `product-catalog`。
- 靜態網站：先執行 `node tools/build_assets.mjs` 產生 `site_dist/`，再部署 Worker。
- 資料庫：部署前須套用 `migrations/` 中的 SQL 遷移。
- 管理端 Secrets：`ADMIN_USERNAME`、`ADMIN_PASSWORD_HASH`、`SESSION_SECRET`；不可寫入 GitHub。
- 測試：`node tests/check_static.mjs`、`node tests/check_backup.mjs`、`node tests/check_settings.mjs`。GitHub Actions 工作流程為 `.github/workflows/trial-check.yml`；**提交程式不等於測試通過**。
- 備份：可匯出及檢查；**覆蓋還原尚未啟用**，且單次照片備份容量有 18 MiB 限制。
- 正式發布前：必須驗證 Worker 實際部署、D1 遷移、登入、照片上傳、草稿／公開隔離、備份與 iPad 實機流程；不得宣稱已完成。

## 注意

目前的照片存儲與備份機制只適合小規模測試。若要每季上架約 800 張照片，應先完成容量與費用評估，再決定是否改用其他照片儲存方案。未經使用者同意，不應啟用任何付費服務。

## 上線後唯讀檢查

部署完成後，可以執行 `node tools/check_live_site.mjs https://product-catalog.clara0189.workers.dev`，檢查首頁、管理頁、健康檢查，以及未登入時管理 API 是否拒絕存取。此指令不登入、不修改資料，也不會部署；成功不代表照片上傳或發布功能已驗收。
