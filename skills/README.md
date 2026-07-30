# Skill 资产约定

`skills/` 保存可受控优化的 Agent Skill 或 Prompt 正文。每个 Skill 使用独立 Markdown 文件并在文件头声明 `agent`、`skillId`、`version`。平台只允许通过 Bounded Edit 记录 `add`、`delete`、`replace` 三类最小修改；候选修改必须由独立 Validation Run 决定是否接受。

密钥、线上连接配置和生产 Trace 不得写入本目录。
