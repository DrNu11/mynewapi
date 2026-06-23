export const PPT_SCENARIOS = [
  '商业计划书',
  '课程课件',
  '项目汇报',
  '产品介绍',
  '论文答辩',
  '工作总结',
  '营销方案',
  '培训材料',
] as const;

export const PPT_STYLES = [
  '商务科技风',
  '简洁白底',
  '深色路演',
  '教育清爽',
  '产品发布',
] as const;

export const PPT_TEMPLATES = [
  { id: 'business-blue', label: '商务蓝' },
  { id: 'tech-dark', label: '科技黑' },
  { id: 'simple-white', label: '简洁白' },
  { id: 'education', label: '课程绿' },
  { id: 'product-intro', label: '产品紫' },
] as const;

export type PptScenario = (typeof PPT_SCENARIOS)[number];
export type PptStyle = (typeof PPT_STYLES)[number];
export type PptTemplateId = (typeof PPT_TEMPLATES)[number]['id'];

export interface PptCreateInput {
  apiKey: string;
  title: string;
  scenario: string;
  style: string;
  slideCount: number;
  templateId: string;
  inputText: string;
}

export interface PptSlideOutline {
  title: string;
  bullets: string[];
}

