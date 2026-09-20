# WorkHub API

`/api/` 接口除初始化/登录外需要 Cookie 或 Bearer Token。业务响应一般为 `{data:...}`，认证、设置和助手运行使用顶层对象。错误为 `{error:{code,message,details?}}`。

## 推荐流程

1. `GET /api/v1/schema` 读取完整数据约束。
2. `GET /api/v1/tasks` 找到任务，全局写入凭证也可 POST 创建任务。
3. `GET /api/v1/tasks/:id/context` 获取内容、采用的原则版本、矩阵和验收缺口。
4. 创建/修改结构化记录，对相同请求重试使用稳定的幂等键。
5. 请求评审，Owner 在统一界面确认；质量 Agent 追加验证结果，Owner 最终验收。

```sh
curl https://workhub.example.com/api/v1/tasks/TASK_ID/context \
  -H "Authorization: Bearer $WORKHUB_TOKEN"

curl https://workhub.example.com/api/v1/tasks/TASK_ID/requirements \
  -H "Authorization: Bearer $WORKHUB_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: article-search-requirement-v1' \
  -d '{"title":"按关键词查找匹配的文章","body":"搜索结果包含匹配的文章，且每篇文章只出现一次。","data":{"priority":"must"}}'
```

路径 ID 是返回的 `id`（UUID），不是展示编号 TASK-001。PowerShell 可使用 Invoke-RestMethod 和 ConvertTo-Json，避免 Shell 引号差异。

## 资源和版本

`GET /api/v1/records?kind=design&taskId=UUID&q=搜索&offset=0&limit=100` 支持筛选和分页，limit 最大 500，返回 data/total/nextOffset。类型别名 GET 适合个人空间批量读取，当前不分页。

| 路径                        | kind              | data 关键字段                                                                                          |
| --------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| projects                    | project           | tags                                                                                                   |
| tasks                       | task              | type、priority、template、codeRef                                                                      |
| requirement-groups          | requirement_group | order                                                                                                  |
| requirements                | requirement       | groupId、priority                                                                                      |
| criteria                    | criterion         | requirementId、applicable、exclusionReason                                                             |
| designs                     | design            | category、required                                                                                     |
| work-items                  | work_item         | assignee、required                                                                                     |
| issues                      | issue             | severity、blocking、checkIds                                                                           |
| test-cases / quality-checks | check             | criterionIds、type、required、preconditions、steps、expectedResult、automationRef                      |
| quality-runs                | result            | checkId、checkVersion、criterionVersions、requirementVersions、codeRef、outcome、evidence、environment |
| todos                       | todo              | type、priority、tags                                                                                   |
| principles                  | principle         | scope（仅 task）、strength、category、rationale                                                        |
| questions                   | question          | blocking                                                                                               |

全部类型支持 `GET/POST /api/v1/:路径`。任务内类型还支持 `POST /api/v1/tasks/:id/:路径`。通用 `POST /api/v1/records` 需额外传 kind。公共字段为 title/body/taskId/projectId/data/approve；Agent 禁止 approve:true。

`PATCH /api/v1/records/:id` 示例：

```json
{
  "expectedVersion": 3,
  "body": "修订后的设计说明",
  "data": { "required": true }
}
```

只允许修改 title/body/data。修改使版本递增，已确认的旧版保持可追溯；不能用旧批准覆盖新内容。projectId/taskId 不支持普通编辑迁移。

| 操作           | 接口和正文                                                                      |
| -------------- | ------------------------------------------------------------------------------- |
| 历史           | GET `/api/v1/records/:id/revisions`                                             |
| 状态           | POST `/api/v1/records/:id/transitions`：expectedVersion + status                |
| 请求评审       | POST `/api/v1/records/:id/review`：expectedVersion                              |
| Owner 确认     | POST `/api/v1/records/:id/approve`：expectedVersion + comment                   |
| Owner 归档     | POST `/api/v1/records/:id/archive`：expectedVersion                             |
| 想法转任务     | POST `/api/v1/todos/:id/convert`：expectedVersion + projectId                   |
| 采用原则       | POST `/api/v1/tasks/:id/principle-adoptions`：expectedVersion                   |
| Owner 核对原则 | POST `/api/v1/tasks/:id/principle-checks`：expectedVersion + principleId + note |
| Owner 豁免     | POST `/api/v1/criteria/:id/waivers`：expectedVersion + reason                   |
| 验收缺口       | GET `/api/v1/tasks/:id/completion-check`                                        |
| Owner 验收     | POST `/api/v1/tasks/:id/acceptances`：expectedVersion                           |

已关闭任务需先重新打开。执行结果只能追加，仍被引用的条目不能归档。waiver/targetTaskId/principles/principleChecks/disposition 是服务端维护字段，普通写入禁止伪造。

## 任务归属、需求生命周期和追溯

原则必须带 taskId；默认 scope=task，不再支持创建全局或项目原则。待办可全局创建或附带 taskId。原则和待办都支持任务内嵌套创建路径。

- `POST /api/v1/todos/:id/assign`：`{expectedVersion,taskId}`，taskId 可为 null 表示全局；调用者需同时拥有来源与目标权限。
- `POST /api/v1/requirements/:id/reject` / `delete`：`{expectedVersion,reason}`，Owner 专属，填写原因，不删除关联历史。
- `POST /api/v1/requirements/:id/restore`：`{expectedVersion,reason?}`，Owner 专属，恢复为待确认需求。上述接口支持 Idempotency-Key。
- `GET /api/v1/tasks/:id/traceability`：多对多标准/用例关系、最新结果、关联问题、缺口、范围外需求。矩阵报告和上下文也携带该结构。
- `requirement_group` 是稳定的分组记录；需求用 `data.groupId` 关联同任务分组。修改分组名不会改需求版本。

拒绝和删除需求退出当前验收、待处理及默认 Agent 上下文，仍可通过 records/list_records 浏览，任务上下文也保留 excludedRequirements。恢复后旧证据待复验。版本 2 执行接口必须提供 requirementVersions；历史缺失该映射的执行不会被自动补造或视作有效证据。

## 质量证据

提交到 `POST /api/v1/tasks/:id/quality-runs`：

```json
{
  "title": "CI 文章搜索回归",
  "data": {
    "checkId": "CHECK_UUID",
    "checkVersion": 2,
    "criterionVersions": { "CRITERION_UUID": 3 },
    "requirementVersions": { "REQUIREMENT_UUID": 2 },
    "codeRef": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "outcome": "passed",
    "evidence": "https://ci.example/job/123 — 1000 次执行，0 失败",
    "environment": "Linux x64 / Node 22 / Chrome"
  }
}
```

outcome 支持 passed/failed/blocked/skipped/error。SHA 必须是实际执行测试的代码。旧代码结果可以保存，但矩阵显示过期；需求/用例/标准版本已变化时提交返回 409。evidence 是文本或链接，暂不上传二进制附件。

## 报告、事件与助手

- GET `/api/v1/tasks/:id/acceptance-matrix`：矩阵、指标和门槛。
- GET `/api/v1/tasks/:id/export?format=csv|markdown|json`。
- POST `/api/v1/tasks/:id/report-snapshots`；GET `/api/v1/tasks/:id/reports`；GET `/api/v1/report-snapshots/:id`。
- GET `/api/v1/events?after=0` 返回 items/cursor；后续用 cursor 增量读取，只暴露授权内容。
- GET `/api/v1/inbox`：未确认内容与待处理项。
- GET `/api/v1/workspace/export`：Owner 业务归档，不含任何凭证。
- GET/PUT/DELETE `/api/settings/llm`：Owner 模型设置。
- POST `/api/assistant/runs`：`{question,taskId?,summary?}` 返回 202 和 id。
- GET `/api/assistant/runs/:id`、POST `/api/assistant/runs/:id/cancel`、GET `/api/tasks/:id/summary`。
- 外部 Agent 调用助手需额外 `assistant:invoke` 权限，仍受任务范围限制。

## MCP

新增 `assign_todo_to_task` 工具（id、expectedVersion、taskId、idempotencyKey）；`get_quality_matrix` 返回 traceability。`workhub://schema` 当前 version 为 2。

工具：get_task_context、list_records、create_record、update_record、transition_record、request_review、get_quality_matrix、convert_todo_to_task。资源：`workhub://guide` 与 `workhub://schema`。

基于官方 SDK 的无状态 Streamable HTTP，返回 JSON；GET SSE 和 DELETE session 为 405。客户端需发送 `Accept: application/json, text/event-stream`。

```json
{
  "mcpServers": {
    "workhub": {
      "url": "https://workhub.example.com/mcp",
      "headers": { "Authorization": "Bearer REPLACE_WITH_TOKEN" }
    }
  }
}
```

具体配置格式取决于客户端。OAuth 元数据位于 `/.well-known/oauth-protected-resource/mcp` 和 `/.well-known/oauth-authorization-server`；scope 为 `workhub:read` 或 `workhub:read workhub:write`，资源地址必须为 `/mcp`，使用 S256 PKCE。刷新只读授权不会升级为写入权限。
