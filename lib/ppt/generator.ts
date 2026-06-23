import fs from 'node:fs/promises';
import path from 'node:path';
import pptxgen from 'pptxgenjs';
import { PPT_TASKS_DIR } from '@/lib/ppt/paths';
import type { PptSlideOutline } from '@/lib/ppt/types';

interface Theme {
  bg: string;
  panel: string;
  accent: string;
  accent2: string;
  text: string;
  muted: string;
  inverse: string;
}

export interface BuildPptxInput {
  taskId: string;
  title: string;
  scenario: string;
  style: string;
  slideCount: number;
  templateId: string;
  inputText: string;
}

export interface BuildPptxResult {
  filePath: string;
  outlinePath: string;
  outline: PptSlideOutline[];
}

const THEMES: Record<string, Theme> = {
  'business-blue': {
    bg: 'F8FAFC',
    panel: 'E0F2FE',
    accent: '2563EB',
    accent2: '0EA5E9',
    text: '0F172A',
    muted: '475569',
    inverse: 'FFFFFF',
  },
  'tech-dark': {
    bg: '0B1120',
    panel: '111827',
    accent: '22D3EE',
    accent2: 'A78BFA',
    text: 'E5E7EB',
    muted: '94A3B8',
    inverse: '020617',
  },
  'simple-white': {
    bg: 'FFFFFF',
    panel: 'F1F5F9',
    accent: '111827',
    accent2: '64748B',
    text: '111827',
    muted: '64748B',
    inverse: 'FFFFFF',
  },
  education: {
    bg: 'F7FEE7',
    panel: 'DCFCE7',
    accent: '16A34A',
    accent2: '65A30D',
    text: '14532D',
    muted: '3F6212',
    inverse: 'FFFFFF',
  },
  'product-intro': {
    bg: 'FAF5FF',
    panel: 'EDE9FE',
    accent: '7C3AED',
    accent2: 'DB2777',
    text: '1E1B4B',
    muted: '5B21B6',
    inverse: 'FFFFFF',
  },
};

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

function cleanText(value: string): string {
  return value
    .replace(/[#>*`_~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitInput(input: string): string[] {
  const lines = input
    .split(/\n|。|；|;|\.\s+/)
    .map(cleanText)
    .filter((line) => line.length >= 4);
  return lines.length > 0 ? lines : ['明确目标用户和核心需求', '提炼产品价值和差异化优势', '规划落地路径、资源投入和阶段成果'];
}

function chunkBullets(seed: string[], index: number): string[] {
  const start = (index * 3) % seed.length;
  const picked = [seed[start], seed[(start + 1) % seed.length], seed[(start + 2) % seed.length]]
    .map((s) => (s.length > 54 ? `${s.slice(0, 54)}...` : s));
  return [
    picked[0],
    picked[1],
    picked[2],
    '形成可执行的下一步动作和衡量指标',
  ];
}

function buildOutline(input: BuildPptxInput): PptSlideOutline[] {
  const seed = splitInput(input.inputText);
  const contentCount = Math.max(1, input.slideCount - 3);
  const scenarioTitles = [
    `${input.scenario}背景`,
    '目标用户与核心问题',
    '解决方案设计',
    '关键能力与亮点',
    '执行路径',
    '资源投入',
    '风险与应对',
    '预期成果',
    '阶段计划',
    '复盘指标',
    '下一步行动',
    '附录要点',
  ];

  const contentSlides = Array.from({ length: contentCount }, (_, i) => ({
    title: scenarioTitles[i] || `核心内容 ${i + 1}`,
    bullets: chunkBullets(seed, i),
  }));

  return [
    {
      title: input.title,
      bullets: [input.scenario, input.style, `共 ${input.slideCount} 页`],
    },
    {
      title: '目录',
      bullets: contentSlides.slice(0, 5).map((s) => s.title),
    },
    ...contentSlides,
    {
      title: '总结与行动',
      bullets: ['聚焦最重要的业务目标', '把方案拆成可交付任务', '按里程碑复盘结果并持续迭代'],
    },
  ].slice(0, input.slideCount);
}

function addPageNumber(slide: pptxgen.Slide, page: number, total: number, theme: Theme) {
  slide.addText(`${page}/${total}`, {
    x: 11.85,
    y: 6.9,
    w: 0.8,
    h: 0.25,
    fontSize: 8,
    color: theme.muted,
    align: 'right',
  });
}

function addBrandBar(slide: pptxgen.Slide, theme: Theme) {
  slide.addShape('rect', { x: 0, y: 0, w: 0.11, h: SLIDE_H, fill: { color: theme.accent }, line: { color: theme.accent } });
  slide.addShape('rect', { x: 0.11, y: 0, w: 0.04, h: SLIDE_H, fill: { color: theme.accent2 }, line: { color: theme.accent2 } });
}

function addCover(pptx: pptxgen, outline: PptSlideOutline, input: BuildPptxInput, theme: Theme) {
  const slide = pptx.addSlide();
  slide.background = { color: theme.bg };
  addBrandBar(slide, theme);
  slide.addShape('rect', { x: 0.85, y: 0.75, w: 11.65, h: 5.9, fill: { color: theme.panel, transparency: 8 }, line: { color: theme.panel, transparency: 100 } });
  slide.addText('Nassa PPT', {
    x: 1.15,
    y: 1.0,
    w: 2.2,
    h: 0.35,
    fontFace: 'Microsoft YaHei',
    fontSize: 15,
    bold: true,
    color: theme.accent,
  });
  slide.addText(outline.title, {
    x: 1.1,
    y: 2.05,
    w: 10.6,
    h: 1.1,
    fontFace: 'Microsoft YaHei',
    fontSize: 31,
    bold: true,
    color: theme.text,
    fit: 'shrink',
  });
  slide.addText(`${input.scenario} · ${input.style}`, {
    x: 1.12,
    y: 3.45,
    w: 8.5,
    h: 0.38,
    fontFace: 'Microsoft YaHei',
    fontSize: 14,
    color: theme.muted,
  });
  slide.addShape('line', { x: 1.12, y: 4.18, w: 3.2, h: 0, line: { color: theme.accent, width: 2 } });
  slide.addText(new Date().toLocaleDateString('zh-CN'), {
    x: 1.12,
    y: 5.55,
    w: 2,
    h: 0.25,
    fontSize: 9,
    color: theme.muted,
  });
}

function addAgenda(pptx: pptxgen, outline: PptSlideOutline, theme: Theme, page: number, total: number) {
  const slide = pptx.addSlide();
  slide.background = { color: theme.bg };
  addBrandBar(slide, theme);
  slide.addText(outline.title, { x: 0.95, y: 0.75, w: 4, h: 0.5, fontFace: 'Microsoft YaHei', fontSize: 24, bold: true, color: theme.text });
  outline.bullets.forEach((item, i) => {
    const y = 1.75 + i * 0.85;
    slide.addShape('ellipse', { x: 1.0, y, w: 0.34, h: 0.34, fill: { color: theme.accent }, line: { color: theme.accent } });
    slide.addText(String(i + 1).padStart(2, '0'), { x: 1.58, y: y - 0.03, w: 0.5, h: 0.3, fontSize: 11, bold: true, color: theme.accent });
    slide.addText(item, { x: 2.2, y: y - 0.06, w: 8.8, h: 0.42, fontFace: 'Microsoft YaHei', fontSize: 15, color: theme.text, fit: 'shrink' });
  });
  addPageNumber(slide, page, total, theme);
}

function addContentSlide(pptx: pptxgen, outline: PptSlideOutline, theme: Theme, page: number, total: number) {
  const slide = pptx.addSlide();
  slide.background = { color: theme.bg };
  addBrandBar(slide, theme);
  slide.addText(outline.title, {
    x: 0.95,
    y: 0.65,
    w: 9.8,
    h: 0.62,
    fontFace: 'Microsoft YaHei',
    fontSize: 23,
    bold: true,
    color: theme.text,
    fit: 'shrink',
  });
  slide.addShape('line', { x: 0.95, y: 1.35, w: 2.6, h: 0, line: { color: theme.accent, width: 2 } });
  outline.bullets.slice(0, 4).forEach((item, i) => {
    const x = i % 2 === 0 ? 0.95 : 6.75;
    const y = i < 2 ? 2.0 : 4.25;
    slide.addShape('rect', { x, y, w: 5.15, h: 1.45, fill: { color: theme.panel, transparency: 4 }, line: { color: theme.panel, transparency: 100 } });
    slide.addText(String(i + 1), { x: x + 0.28, y: y + 0.24, w: 0.42, h: 0.32, fontSize: 13, bold: true, color: theme.accent });
    slide.addText(item, {
      x: x + 0.82,
      y: y + 0.24,
      w: 3.9,
      h: 0.88,
      fontFace: 'Microsoft YaHei',
      fontSize: 14,
      color: theme.text,
      fit: 'shrink',
      breakLine: false,
    });
  });
  addPageNumber(slide, page, total, theme);
}

function addClosing(pptx: pptxgen, outline: PptSlideOutline, theme: Theme, page: number, total: number) {
  const slide = pptx.addSlide();
  slide.background = { color: theme.bg };
  addBrandBar(slide, theme);
  slide.addText(outline.title, { x: 0.95, y: 0.78, w: 7, h: 0.5, fontFace: 'Microsoft YaHei', fontSize: 24, bold: true, color: theme.text });
  slide.addShape('rect', { x: 0.95, y: 1.65, w: 11.2, h: 4.55, fill: { color: theme.panel, transparency: 4 }, line: { color: theme.panel, transparency: 100 } });
  outline.bullets.forEach((item, i) => {
    slide.addText(item, {
      x: 1.45,
      y: 2.18 + i * 0.88,
      w: 9.8,
      h: 0.42,
      fontFace: 'Microsoft YaHei',
      fontSize: 17,
      color: theme.text,
      bullet: { type: 'bullet' },
      fit: 'shrink',
    });
  });
  slide.addText('Generated by Nassa PPT', { x: 1.45, y: 5.28, w: 3, h: 0.3, fontSize: 10, color: theme.muted });
  addPageNumber(slide, page, total, theme);
}

export async function buildPptx(input: BuildPptxInput): Promise<BuildPptxResult> {
  const theme = THEMES[input.templateId] || THEMES['business-blue'];
  const taskDir = path.join(PPT_TASKS_DIR, input.taskId);
  await fs.mkdir(taskDir, { recursive: true });

  const outline = buildOutline(input);
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Nassa PPT';
  pptx.company = 'NassaAPI';
  pptx.subject = input.scenario;
  pptx.title = input.title;
  pptx.theme = {
    headFontFace: 'Microsoft YaHei',
    bodyFontFace: 'Microsoft YaHei',
  };

  outline.forEach((slide, i) => {
    if (i === 0) addCover(pptx, slide, input, theme);
    else if (i === 1) addAgenda(pptx, slide, theme, i + 1, outline.length);
    else if (i === outline.length - 1) addClosing(pptx, slide, theme, i + 1, outline.length);
    else addContentSlide(pptx, slide, theme, i + 1, outline.length);
  });

  const filePath = path.join(taskDir, 'final.pptx');
  const outlinePath = path.join(taskDir, 'outline.json');
  await fs.writeFile(outlinePath, JSON.stringify({ input, outline }, null, 2));
  await pptx.writeFile({ fileName: filePath, compression: true });

  return { filePath, outlinePath, outline };
}
