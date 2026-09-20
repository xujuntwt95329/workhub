# 精确版本的测试证据

用例记录 kind 为 `check`，类型为 unit/integration/concurrency/performance/manual/compatibility。可填 preconditions、steps、expectedResult、automationRef；criterionIds 指向本任务的验收标准。Issue 用 checkIds 关联用例。

## 执行流程

1. 在测试前读取实际用例、关联的所有标准及它们所属的需求，保存每条记录的 UUID/version。保留所有关联，包括范围外的历史关联；服务端要求映射完整。
2. 确认真正测试的代码 commit（40 位 SHA）、工作树是否干净、环境和运行命令。任务 codeRef 表示验收目标；不要为了“通过”而用该字段代替真实运行 SHA。
3. 实际运行，保存可审计的命令、结果摘要和报告/日志位置。执行期间需求、标准或用例变化时，重新判断并复验，不能把旧运行结果重标为新版本。
4. 追加 result。结果不可编辑，后续重跑使用新记录和新幂等键。

MCP `create_record` 的示例形状（UUID、版本和 SHA 均替换为本次真实值）：

```json
{
  "kind": "result",
  "taskId": "TASK_UUID",
  "title": "文章搜索回归",
  "data": {
    "checkId": "CHECK_UUID",
    "checkVersion": 2,
    "criterionVersions": { "CRITERION_UUID": 3 },
    "requirementVersions": { "REQUIREMENT_UUID": 4 },
    "codeRef": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "outcome": "passed",
    "evidence": "实际执行命令、次数、断言结果和日志/报告位置",
    "environment": "操作系统、运行时、关键配置"
  },
  "idempotencyKey": "ONE_UNIQUE_KEY_FOR_THIS_EXECUTION"
}
```

示例不是已经执行的证据。outcome 可为 passed/failed/blocked/skipped/error；未真正执行时不能选 passed。服务端拒绝过期或无关的版本映射；SHA 与任务目标不一致时可以保存历史结果，但矩阵会标记待复验。

## 覆盖口径

服务端按验收标准去重：所有必需用例当前都通过才算标准通过。没有必需用例、未执行、跳过、阻塞和错误不算通过。可选用例的失败单独报告。

拒绝/删除需求的标准不参与当前验收；仅关联这些标准的用例为范围外。混合关联的用例仍对当前标准参与计算。恢复需求会改变版本，要求重新确认与复验。

旧执行缺少 requirementVersions 时视为待复验；不要回填猜测值。不适用和人工豁免单独统计，不增加通过率。以 get_quality_matrix 返回的指标和 gaps 为准，不修改范围来改善数字。
