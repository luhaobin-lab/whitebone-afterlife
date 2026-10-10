import { ENCOUNTERS, getEnemy } from '../content';
import { Rng } from './random';
import type { EnemySpawn, NodeKind } from './types';
import type { MapNode } from './run';

const SERVICE_KINDS: NodeKind[] = ['shop', 'grave', 'workshop', 'event'];
const KIND_NAMES: Record<NodeKind, string[]> = {
  normal: ['征粮驿站', '漏税村口', '收费墓道', '停薪营地', '钟楼街区', '失守哨所'],
  elite: ['誓约堡垒', '重税关卡', '军饷金库', '王室兵站'],
  boss: ['欠薪领主的村堡', '收税伯爵的外城', '最后国王的王都'],
  shop: ['亡者黑市', '骨董夜市', '棺材批发部'],
  grave: ['公费墓园', '轮休安置所', '亡者疗养院'],
  workshop: ['邪术工坊', '概率计量局', '墓匠改装间'],
  event: ['路边怪事', '过期公文', '意外的访客'],
};

function wavesFor(act: number, layer: number, kind: NodeKind, rng: Rng): EnemySpawn[][] {
  if (!['normal', 'elite', 'boss'].includes(kind)) return [];
  const nodeId = kind === 'boss' ? 'N03' : kind === 'elite' ? 'N02' : 'N01';
  const sourceLayer = kind === 'boss' ? 5 : kind === 'elite' ? 3 : layer === 1 ? 1 : 3;
  const templates = ENCOUNTERS.filter(e => e.act === act && e.node_id === nodeId && e.route_layer === sourceLayer)
    .sort((a, b) => a.wave - b.wave);
  const stage = kind === 'boss' ? 1 : layer === 1 ? .90 : layer === 3 ? 1 : 1.08;
  const attackStage = layer === 1 ? .90 : stage;
  return templates.map((template, waveIndex) => {
    const hpScale = Number((stage * (.97 + rng.next() * .06)).toFixed(3));
    const atkScale = Number((attackStage * (.97 + rng.next() * .06)).toFixed(3));
    return template.enemy_composition.split(',').map(part => {
      const [templateId, countText] = part.split(':');
      let count = Number(countText);
      const boss = kind === 'boss' && waveIndex === 2 && ['E05', 'E10', 'E15'].includes(templateId);
      // Only ordinary late nodes vary a group by one; no untelegraphed reinforcements.
      if (kind === 'normal' && layer > 1 && count > 1 && rng.next() < .22) count += rng.int(-1, 1);
      return { templateId, count: Math.max(1, count), hpScale, atkScale, boss };
    });
  });
}

function lateEncounterProfile(act:number,layer:number,kind:NodeKind,seed:number,waves:EnemySpawn[][]):string|null {
  if(act!==3||layer!==5||!['normal','elite'].includes(kind))return null;
  const last=waves[2],guards=last?.find(e=>e.templateId==='E11');
  if(!guards||guards.count<2)return null;
  // Use the already generated node seed. No new RNG draws or player-dependent
  // counters: map links, earlier waves and the slot RNG sequence stay intact.
  const lightFlanks=kind==='elite'&&seed%2===0;
  guards.count-=2;
  const replacement:EnemySpawn[]=lightFlanks
    ? [{templateId:'E07',count:2},{templateId:'E09',count:2}]
    : [{templateId:'E14',count:2}];
  replacement.forEach(e=>Object.assign(e,{hpScale:guards.hpScale,atkScale:guards.atkScale,boss:false}));
  waves[2]=[...last.filter(e=>e.count>0),...replacement];
  const lineup=waves[2].map(e=>`${getEnemy(e.templateId).name}×${e.count}`).join('、');
  const label=lightFlanks?'轻火力侧翼':kind==='elite'?'双雷矛精英':'雷矛分队';
  const threat=lightFlanks
    ? '危险：轻远程增多；弩手第3箭优先射程内后排，火油寻找密集落点并提前1秒预警。可用范围伤害或机动切入。'
    : '危险：双目标法术打击；让核心与承伤位保持距离，分散支援，避免扎堆。';
  return `第3波【${label}】：${lineup}。${threat}`;
}

export function generateCampaignMap(rng: Rng): MapNode[] {
  const map: MapNode[] = [];
  for (let act = 1; act <= 3; act++) {
    for (let layer = 1; layer <= 7; layer++) {
      const lanes = layer === 7 ? [1] : [0, 1, 2];
      let kinds: NodeKind[];
      if (layer === 7) kinds = ['boss'];
      // At most two event visits per act: eight unique authored events cannot exhaust in six visits.
      else if (layer % 2 === 0) kinds = rng.shuffle(layer === 2 ? SERVICE_KINDS.filter(k => k !== 'event') : SERVICE_KINDS).slice(0, 3);
      else if (layer === 1) kinds = ['normal', 'normal', 'normal'];
      else kinds = rng.shuffle<NodeKind>(['normal', 'elite', rng.next() < .5 ? 'normal' : 'elite']);
      lanes.forEach((lane, index) => {
        const kind = kinds[index];
        const waves = wavesFor(act, layer, kind, rng);
        const name=kind === 'boss' ? KIND_NAMES.boss[act - 1] : rng.pick(KIND_NAMES[kind]);
        const seed=rng.int(1,0x7fffffff);
        const profile=lateEncounterProfile(act,layer,kind,seed,waves);
        map.push({
          id: `A${act}-L${layer}-${lane}`, act, layer, lane, kind,
          name, links: [], visited: false, completed: false, seed, waves,
          preview: waves.length
            ? `${profile??'3波守军已侦察'}${profile?'':'；'}本据点基础生命与攻击倍率约${Math.round((waves[0][0]?.hpScale ?? 1) * 100)}%。`
            : '可查看完整服务与价格；无需使用也可离开。',
          rewardPreview: kind === 'normal' ? '普通 / 普通 / 稀有，或整组换引魂券'
            : kind === 'elite' ? '稀有 / 稀有 / 传奇'
            : kind === 'boss' ? '传奇候选；前两章机器槽+1' : '明确代价的经营服务',
        });
      });
    }
  }
  for (const node of map) {
    if (node.layer === 7) {
      node.links = map.filter(n => n.act === node.act + 1 && n.layer === 1).map(n => n.id);
      continue;
    }
    const candidates = map.filter(n => n.act === node.act && n.layer === node.layer + 1 && Math.abs(n.lane - node.lane) <= 1);
    const count = Math.min(candidates.length, rng.int(1, 2));
    node.links = rng.shuffle(candidates).slice(0, count).map(n => n.id);
  }
  // Every drawn node must be reachable from an act's first layer. Random
  // outgoing links alone can strand entire lanes despite every path ending.
  for (const node of map.filter(n => n.layer > 1)) {
    if (map.some(parent => parent.links.includes(node.id))) continue;
    const parents = map.filter(parent => parent.act === node.act && parent.layer === node.layer - 1
      && Math.abs(parent.lane - node.lane) <= 1 && parent.links.length < 2);
    // On the three-lane adjacent graph an orphan always has a parent with room.
    if (!parents.length) throw new Error(`Cannot connect map node ${node.id}`);
    rng.pick(parents).links.push(node.id);
  }
  return map;
}
