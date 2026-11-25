> Historical SQL design notes. Current deployment is self-hosted PostgreSQL. Run `npm run db:migrate` to install the local auth compatibility layer and this unchanged business migration. See the root README and deploy/README.md; do not configure a new Supabase project for this build.

# 数据库部署与安全说明

## 正式部署（需要家长自己的 Supabase 项目）

1. 在自己的 Supabase 组织中新建项目，选择合适的数据驻留地区；部署前审阅服务条款及价格。不要在聊天中发送数据库密码或管理员密钥。
2. 用 Supabase Dashboard SQL Editor，或官方 CLI `supabase db push` 执行 `migrations/202611110001_initial.sql`。迁移应由项目管理角色执行一次。
3. 开启 Email/Password Auth，并按家庭使用习惯保留邮箱验证；配置实际 HTTPS 域名为 Site URL 和允许回调 URL。允许注册意味着每个注册家长可创建自己的家庭，所有记录仍由 RLS 隔离。
4. 前端环境只需项目 URL 和 publishable/anon key。该 key 不是管理员密钥，不授予跨家庭访问。绝不能把 service_role key、数据库连接密码或 JWT secret 放入 `NEXT_PUBLIC_*` 或浏览器代码。
5. 在新注册的测试家长账号中创建家庭；第二个独立家长账号应看不到第一个账号的家庭、孩子和记录。
6. 完成真实设备、身份认证与数据库往返测试后再输入真实孩子昵称。首次创建自动生成“星星”“月亮”作为可编辑占位资料，不要求真实姓名、年龄、出生日期或学校。

## 权限与家长模式

- Supabase Auth 负责家长账户身份。每个 Auth 用户只能拥有一个家庭；每个家庭最多两个孩子。
- 所有公开业务表开启 RLS，只允许本人家庭读取。匿名访问无权读取任何业务表。
- 浏览器角色没有业务表 INSERT/UPDATE/DELETE 权限；所有写操作通过 RPC。RPC 内必须重新核对 auth.uid()、家庭及每个对象归属，不能信任前端 child_id。
- 家长 PIN 是6–12位数字，以带盐 bcrypt 存储在 private schema；无前端可读权限。错误5次锁定5分钟。
- 解锁得到30分钟随机令牌，数据库只保存 SHA-256 摘要并绑定家长 Auth 用户及家庭。应仅保存在页面内存中，刷新后重新解锁。PIN变更作废所有解锁令牌。
- 当前是一台家庭共用设备的儿童模式，不是两个独立未成年人账号。已经登录同一个家长 Auth 会话的设备，可读本家庭信息；PIN主要保护管理、审核、回补、配置，不是密码学意义的兄弟姐妹资料隔离。若需要更强隐私分隔，第二阶段增加独立受限设备凭证。
- 每次打卡、撤销、兑换使用幂等请求 UUID；重试相同请求不重复发星。重复 UUID 若 payload 不同会被拒绝。
- 星星由只追加的流水计算，家长撤销已花掉的星星时可出现负余额，此时禁止继续兑换；这是纠错，并非惩罚规则。
- 奖励申请时先预留星星，审批拒绝退回，批准不会重复扣除。

## 计时规则

- 开始/暂停/恢复/结束时间全部取数据库服务器时间。客户端时钟只用于倒计时展示，刷新不改变真实记录。
- 每个孩子同一时间只能有一个活动计时器；专注可暂停，游戏不可暂停来绕过每日额度。
- 专注满目标时长才标记完成，提前结束保留实际时长而不判成功。
- 游戏在约定时长+60秒保存缓冲内由孩子确认结束才记守约；超时只能如实记录，或由家长带原因修正。
- 游戏跨午夜时，下一天的额度扣除那一天实际占用的时间，不通过开始日期规避额度。
- iPad Safari 切后台/锁屏时不能保证发声或推送通知；回来时根据真实时间恢复。当前没有后台强制关闭游戏或系统级闹钟。

## 备份与恢复

- 在家长模式定期导出 JSON/CSV 留存。JSON便于审阅，但当前没有前端“导入覆盖恢复”，不要把导出当作一键数据库恢复。
- 开启 Supabase 项目支持的数据库备份，并了解当前套餐的保留期及是否包含时间点恢复。不要假定免费套餐自动提供所需的备份。
- 管理员可用官方 Supabase CLI / pg_dump 对 public 与 private schema 加密备份；备份含孩子昵称、行为记录及令牌摘要，应限制访问。Auth 数据需遵循官方迁移流程，不能只恢复 public 表就声称账号完整恢复。
- 在独立测试项目中定期演练恢复：执行schema后恢复业务数据，验证两个家庭RLS、历史打卡、积分余额和计时记录。
- 删除 Auth 用户会级联删除其家庭数据；这是不可逆风险，必须先备份并取得明确确认。

## 已知验证边界

本地 PGlite 测试执行真实 PostgreSQL SQL、权限与事务逻辑，但 auth.uid() 和 auth.users 是测试桩，不能替代真实 Supabase Auth、邮件确认、互联网延迟和跨设备测试。正式项目创建及迁移成功必须依据实际工具回执，不应从本地测试推断已上线。
