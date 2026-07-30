/**
 * Part0 Agent 分类 — 类型常量
 * 来源：方法论文章 6 类分类表
 */
export const AGENT_TYPE_OPTIONS = [
  {
    value: "knowledge-qa",
    label: "知识问答型",
    description: "FAQ/政策咨询/内部知识库",
    evalFocus: "准确性/忠实性/引用溯源",
    methods: "RAG指标/事实核验/人工抽检",
  },
  {
    value: "task-execution",
    label: "任务执行型",
    description: "退款/下单/预约/工单处理",
    evalFocus: "工具选择/参数正确/状态变更",
    methods: "Trace校验/数据库状态对比",
  },
  {
    value: "reasoning-decision",
    label: "推理决策型",
    description: "故障诊断/方案推荐/数据分析",
    evalFocus: "推理过程/证据链/结论可信度",
    methods: "轨迹评测/专家Judge",
  },
  {
    value: "multi-turn-guide",
    label: "多轮引导型",
    description: "客服/销售/营销转化",
    evalFocus: "记忆/澄清/推进/情绪承接",
    methods: "User Simulator/Session级评测",
  },
  {
    value: "creative",
    label: "创意生成型",
    description: "文案/图片提示词/活动方案",
    evalFocus: "相关性/风格/合规底线",
    methods: "模型评分/品牌表达标准化",
  },
  {
    value: "multi-agent",
    label: "多Agent协作型",
    description: "多角色复杂任务",
    evalFocus: "路由/协同/交接/整体完成",
    methods: "子Agent评测+端到端评测",
  },
] as const;

export type AgentTypeValue = (typeof AGENT_TYPE_OPTIONS)[number]["value"];
