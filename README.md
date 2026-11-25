# 成长小岛 Growth Island

这是成长小岛 1.0.4 的源码备份。应用源码对应 2026-11-25 核对的正式构建 `4KHmRysQJqSnFHzwbOUPw`；源码基线来自已部署版本的归档，SHA-256 为 `c91e470ea76b16c51987ca9137f69030910d38e08768bed516c9b124a1cf1d12`。

## 目录

- `app/`、`lib/`、`public/`：网页、服务端代码和项目资源。
- `db/`、`supabase/migrations/`：应用数据库迁移。生产家庭数据不在此仓库。
- `scripts/`、`service/`：随应用源码交付的工作进程和电视联动服务代码。
- `deployed-services/`：从当前运行的 Switch 1、Switch 2、电视和时间结算工作进程分别读取的脚本快照，以及备份工具。各工作进程可能采用不同版本；`live-hashes.txt` 记录了读取时的文件哈希。这里的历史 Dockerfile 仅供追溯，不能单独证明整套生产部署可重建。
- `operations/switch-cancel/`：一次已授权、已执行的 Switch 待发送请求退款流程和合成测试；不是常规自动迁移，不应重复运行。

此源码快照不包含数据库、家庭成员记录、照片、账号凭据、设备密钥、网络令牌或生产环境配置。Switch 主机端 PlayGuard 定制源码与当前安装版本尚未完成匹配，不包括在此应用源码快照中；家长不限时功能也尚未交付。历史切换后的数据库和设备当前状态不能仅凭源码推断。

## 开发检查

需要 Node.js 22 和 PostgreSQL。使用独立测试数据库与测试凭据，不要对现有家庭数据库直接运行测试或迁移。

```sh
npm ci
npm run typecheck
npm test
npm run build
```

数据库迁移与服务启动还需要按实际环境提供连接和权限配置；此快照不包含正式部署凭据或个人化配置。
