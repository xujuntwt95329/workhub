---
name: intake
description: 将用户的想法、任务内待办和基本原则录入 WorkHub，或把已有全局待办归入具体任务。用户要求记录灵感、维护原则或整理待办时使用。
---

# 想法与基本原则

先读 [接入协议](../../references/protocol.md)，查询已有相关记录，避免重复录入。

- 尚未归属具体任务的灵感创建为 `todo`，可不带 taskId；当前讨论已明确属于某个任务时带上 taskId。标题简洁，背景写入 body，`data.type` 为 idea 或 todo。
- 把既有待办归入任务用 `assign_todo_to_task`，传来源记录的 expectedVersion、目标任务 UUID 和幂等键。不要通过普通 update 改 taskId，也不要为了关联既有任务而调用 convert。
- 只有用户希望把想法变成一项新的独立工程工作时，才调用 `convert_todo_to_task`；读取源待办和目标项目，保留源记录的关联。
- 原则用 `principle`，必须属于具体任务；`data.scope="task"`，包含 strength（recommended/required）、category、rationale。创建为草稿并请求评审。不要创建全局或项目原则，不替用户批准、采用或核对原则。
- 任务内待办可使用 `transition_record` 变为 planned 或 done；仅在实际工作完成时报告 done。

结束时返回记录编号和简短摘要，不额外生成一套与平台重复的长文档。
