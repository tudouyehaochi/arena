const fs = require('fs');
const path = require('path');

const PRIORITIES = ['high', 'medium', 'low'];

const BUILTIN_SKILLS = [
  { id: 'frontend-design', name: 'Frontend Design', description: 'UX 流程、交互细节、信息架构与视觉规范。', recommendedPriority: 'high', source: 'builtin' },
  { id: 'planning', name: 'Planning', description: '任务拆解、里程碑与验收标准定义。', recommendedPriority: 'high', source: 'builtin' },
  { id: 'code-review', name: 'Code Review', description: '回归风险识别、缺陷定位与变更审查。', recommendedPriority: 'high', source: 'builtin' },
  { id: 'risk-check', name: 'Risk Check', description: '识别高风险路径并给出防御策略。', recommendedPriority: 'medium', source: 'builtin' },
  { id: 'debugging', name: 'Debugging', description: '异常排查、日志分析与复现定位。', recommendedPriority: 'high', source: 'builtin' },
  { id: 'incident-response', name: 'Incident Response', description: '故障应急处置与恢复流程。', recommendedPriority: 'high', source: 'builtin' },
  { id: 'implementation', name: 'Implementation', description: '从方案到代码实现与验证闭环。', recommendedPriority: 'high', source: 'builtin' },
  { id: 'delivery', name: 'Delivery', description: '发布、交付与环境推进。', recommendedPriority: 'medium', source: 'builtin' },
  { id: 'intel-watch', name: 'Intel Watch', description: '外部 AI 资讯追踪与可信来源校验。', recommendedPriority: 'medium', source: 'builtin' },
  { id: 'signal-filter', name: 'Signal Filter', description: '信息降噪、聚类与趋势标签。', recommendedPriority: 'medium', source: 'builtin' },
  { id: 'summarize', name: 'Summarize', description: '复杂会话总结与行动项抽取。', recommendedPriority: 'low', source: 'builtin' },
];

function normalizePriority(v, fallback = 'medium') {
  const s = String(v || '').trim().toLowerCase();
  return PRIORITIES.includes(s) ? s : fallback;
}

function normalizeSkillId(v) {
  return String(v || '').trim().toLowerCase();
}

function firstDescriptionLine(content) {
  const raw = String(content || '');
  const frontmatter = raw.startsWith('---') ? raw.split('---').slice(1, 2)[0] || '' : '';
  const descLine = frontmatter.split('\n').find((line) => line.trim().startsWith('description:'));
  if (descLine) return descLine.replace(/^description:\s*/, '').trim().replace(/^"|"$/g, '');
  const bodyLine = raw.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('#'));
  return bodyLine || '';
}

function readSkillDir(rootDir) {
  const out = [];
  if (!rootDir || !fs.existsSync(rootDir)) return out;
  let names = [];
  try {
    names = fs.readdirSync(rootDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return out;
  }
  for (const name of names) {
    const skillId = normalizeSkillId(name);
    if (!skillId) continue;
    const mdPath = path.join(rootDir, name, 'SKILL.md');
    let description = '';
    if (fs.existsSync(mdPath)) {
      try {
        description = firstDescriptionLine(fs.readFileSync(mdPath, 'utf8'));
      } catch {}
    }
    out.push({
      id: skillId,
      name,
      description: description || '外部技能',
      recommendedPriority: 'medium',
      source: rootDir.includes('/.codex/skills') ? 'local' : 'external',
    });
  }
  return out;
}

function dedupeCatalog(list) {
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const id = normalizeSkillId(item && item.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: String(item.name || id),
      description: String(item.description || ''),
      recommendedPriority: normalizePriority(item.recommendedPriority),
      source: String(item.source || 'builtin'),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function listSkills() {
  const cwdSkillDir = path.join(process.cwd(), '.codex', 'skills');
  const home = process.env.HOME || '';
  const homeSkillDir = home ? path.join(home, '.codex', 'skills') : '';
  return dedupeCatalog([
    ...BUILTIN_SKILLS,
    ...readSkillDir(cwdSkillDir),
    ...readSkillDir(homeSkillDir),
  ]);
}

function hasSkill(skillId) {
  const id = normalizeSkillId(skillId);
  if (!id) return false;
  return listSkills().some((skill) => skill.id === id);
}

module.exports = {
  PRIORITIES,
  BUILTIN_SKILLS,
  normalizePriority,
  normalizeSkillId,
  listSkills,
  hasSkill,
};
