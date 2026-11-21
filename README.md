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

若只有 iPad／手機、沒有本機 Node.js，也可在 GitHub 專案的 **Actions → Live catalog smoke test → Run workflow** 手動執行相同的唯讀檢查。這個工作流程**不會部署網站**，且若 Worker 尚未上線會顯示失敗；請勿將失敗解讀為商品資料遭修改。

## 手動部署（尚未執行）

新增 GitHub Actions **Deploy catalog to Cloudflare (manual)**，只在使用者自行進入 Actions、選擇工作流程並分別輸入 `DEPLOY` 與 `MIGRATE` 後執行；**不會因 GitHub 程式更新而自動部署**。工作流程使用 GitHub Repository Secrets `CLOUDFLARE_API_TOKEN` 與 `CLOUDFLARE_ACCOUNT_ID`，需事先設定具有 Workers 部署及 D1 權限的 Cloudflare API Token。Token 不應貼入聊天或程式碼。部署工作流程依序執行程式檢查、D1 正式資料庫遷移、Worker 部署、唯讀網站檢查；其中 D1 遷移會修改正式資料庫結構，首次執行前應確認資料庫及備份策略。管理員的三項 Cloudflare Secrets 仍需在 Cloudflare Worker 端獨立設定。工作流程的存在不代表已取得授權、已部署成功或已完成 iPad 驗收。

**資料庫變更保護：** 部署與正式 D1 遷移採雙重確認；兩個確認字串有任何一個不符合，整個部署工作不會執行。請先確認正式資料庫有可用的備份，且已了解目前網站尚未提供一鍵還原功能。此設計不能取代資料庫備份與測試。
