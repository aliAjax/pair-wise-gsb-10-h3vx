// exporter.js — 导出模块
// 导出只写校验通过的内容：存在 error 的网段 / 设备 / 连线一律剔除，
// 并连带剔除引用了非法对象的连线，同时给出被剔除内容的清单。

import { validatePlan } from './validation.js';

export function buildExport(plan) {
  const { issues, valid } = validatePlan(plan);

  const badSubnets = new Set();
  const badNodes = new Set();
  const badEdges = new Set();
  const reasons = new Map();

  const note = (map, key, message) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(message);
  };

  for (const i of issues) {
    if (i.level !== 'error') continue;
    if (i.scope === 'subnet') {
      badSubnets.add(i.id);
      note(reasons, `subnet:${i.id}`, i.message);
    } else if (i.scope === 'node') {
      badNodes.add(i.id);
      note(reasons, `node:${i.id}`, i.message);
    } else if (i.scope === 'edge') {
      badEdges.add(i.id);
      note(reasons, `edge:${i.id}`, i.message);
    }
  }

  const omitted = [];

  const subnets = plan.subnets
    .filter((s) => !badSubnets.has(s.id))
    .map(({ id, name, cidr, gateway, vlan }) => ({ id, name, cidr, gateway, vlan }));

  const subnetById = new Map(subnets.map((s) => [s.id, s]));

  const nodes = [];
  for (const n of plan.nodes) {
    if (badNodes.has(n.id)) {
      omitted.push({ kind: 'device', name: n.name, reasons: reasons.get(`node:${n.id}`) || [] });
      continue;
    }
    if (!subnetById.has(n.subnetId)) {
      // 所属网段未通过校验或不存在，设备地址无法成立
      omitted.push({ kind: 'device', name: n.name, reasons: ['所属网段未通过校验'] });
      badNodes.add(n.id);
      continue;
    }
    const subnet = subnetById.get(n.subnetId);
    nodes.push({
      id: n.id,
      name: n.name,
      type: n.type,
      subnet: subnet.name,
      cidr: subnet.cidr,
      vlan: subnet.vlan,
      ip: n.ip,
      gateway: subnet.gateway,
    });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = [];
  for (const e of plan.edges) {
    const nameOf = (id) => plan.nodes.find((n) => n.id === id)?.name || id;
    if (badEdges.has(e.id)) {
      omitted.push({ kind: 'edge', name: `${nameOf(e.a)} ↔ ${nameOf(e.b)}`, reasons: reasons.get(`edge:${e.id}`) || [] });
      continue;
    }
    if (!nodeIds.has(e.a) || !nodeIds.has(e.b)) {
      omitted.push({ kind: 'edge', name: `${nameOf(e.a)} ↔ ${nameOf(e.b)}`, reasons: ['端点设备未通过校验'] });
      continue;
    }
    const a = plan.nodes.find((n) => n.id === e.a);
    const b = plan.nodes.find((n) => n.id === e.b);
    edges.push({
      from: a.name,
      to: b.name,
      sameSubnet: a.subnetId === b.subnetId,
      routed: e.routed,
    });
  }

  const payload = {
    schema: 'network-address-plan/v1',
    exportedAt: new Date().toISOString(),
    summary: {
      subnets: subnets.length,
      devices: nodes.length,
      links: edges.length,
      allPassed: valid && omitted.length === 0,
    },
    subnets,
    devices: nodes,
    links: edges,
  };

  return { payload, omitted, fullyValid: valid && omitted.length === 0 };
}

export function downloadExport(plan) {
  const { payload } = buildExport(plan);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'network-address-plan.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
