// 影响分析：在移除设备、调整网段或 VLAN 之前，预演变更并列出受影响的设备与连线。
// 所有函数返回 { devices, links, blockers, nextData? }，不修改原数据。
import { isCrossSubnet, validateDeviceAddress } from './validation.js';

export function edgeLabel(edge, data) {
  const a = data.nodes.find((n) => n.id === edge.a);
  const b = data.nodes.find((n) => n.id === edge.b);
  return `${a?.name ?? edge.a} ↔ ${b?.name ?? edge.b}`;
}

// 连线在变更前后的跨网段状态对比，只保留受影响的连线。
function affectedLinks(data, nextData, filter) {
  const links = [];
  for (const e of data.edges.filter(filter)) {
    const wasCross = isCrossSubnet(e, data);
    const willCross = isCrossSubnet(e, nextData);
    if (!wasCross && !willCross) continue;
    let note = '跨网段连线';
    if (!wasCross && willCross) note = '将变为跨网段连线，需标明路由';
    else if (wasCross && !willCross) note = '将变为同网段直连';
    links.push({ id: e.id, label: edgeLabel(e, data), note, needsRoute: willCross && !String(e.route || '').trim(), route: e.route || '' });
  }
  return links;
}

export function deviceRemovalImpact(nodeId, data) {
  const node = data.nodes.find((n) => n.id === nodeId);
  const addr = data.addressing?.[nodeId];
  const subnet = addr && data.subnets.find((s) => s.id === addr.subnetId);
  const links = data.edges.filter((e) => e.a === nodeId || e.b === nodeId);
  const neighborIds = [...new Set(links.flatMap((e) => [e.a, e.b]).filter((id) => id !== nodeId))];
  const devices = [
    {
      id: nodeId,
      name: node?.name || nodeId,
      note: addr ? `将被删除，地址 ${addr.ip} 释放回「${subnet?.name || addr.subnetId}」` : '将被删除',
    },
    ...neighborIds.map((id) => {
      const n = data.nodes.find((x) => x.id === id);
      return { id, name: n?.name || id, note: '将失去一条连线' };
    }),
  ];
  return {
    devices,
    links: links.map((e) => ({ id: e.id, label: edgeLabel(e, data), note: '将被删除' })),
    blockers: [],
  };
}

// 网段变更的级联结果：网关跟随网段更新（未自定义过的设备），VLAN 与网段保持一致。
export function cascadeSubnetChange(data, subnetId, next) {
  const prev = data.subnets.find((s) => s.id === subnetId);
  const subnets = data.subnets.map((s) => (s.id === subnetId ? { ...s, ...next, vlan: Number(next.vlan) } : s));
  const addressing = { ...data.addressing };
  for (const [nodeId, addr] of Object.entries(addressing)) {
    if (!addr || addr.subnetId !== subnetId) continue;
    addressing[nodeId] = {
      ...addr,
      vlan: Number(next.vlan),
      gateway: prev && addr.gateway === prev.gateway ? next.gateway : addr.gateway,
    };
  }
  return { ...data, subnets, addressing };
}

export function subnetChangeImpact(subnetId, next, data) {
  const nextData = cascadeSubnetChange(data, subnetId, next);
  const devices = [];
  const blockers = [];
  for (const n of data.nodes) {
    const addr = data.addressing?.[n.id];
    if (!addr || addr.subnetId !== subnetId) continue;
    const after = nextData.addressing[n.id];
    const notes = [];
    if (Number(after.vlan) !== Number(addr.vlan)) notes.push(`VLAN ${addr.vlan} → ${after.vlan}`);
    if (after.gateway !== addr.gateway) notes.push(`网关 ${addr.gateway} → ${after.gateway}`);
    const problems = validateDeviceAddress(n.id, after, nextData).map((i) => i.message);
    blockers.push(...problems);
    devices.push({ id: n.id, name: n.name, note: notes.join('；') || '地址资料保持不变', problems });
  }
  const memberIds = new Set(devices.map((d) => d.id));
  const links = affectedLinks(data, nextData, (e) => memberIds.has(e.a) || memberIds.has(e.b));
  return { devices, links, blockers, nextData };
}

// 设备调整网段/IP 等地址资料时的影响预演。
export function deviceMoveImpact(nodeId, nextAddr, data) {
  const nextData = { ...data, addressing: { ...data.addressing, [nodeId]: nextAddr } };
  const node = data.nodes.find((n) => n.id === nodeId);
  const sub = data.subnets.find((s) => s.id === nextAddr.subnetId);
  const problems = validateDeviceAddress(nodeId, nextAddr, nextData).map((i) => i.message);
  const devices = [
    {
      id: nodeId,
      name: node?.name || nodeId,
      note: `登记到「${sub?.name || nextAddr.subnetId}」：${nextAddr.ip} · 网关 ${nextAddr.gateway} · VLAN ${nextAddr.vlan}`,
      problems,
    },
  ];
  const links = affectedLinks(data, nextData, (e) => e.a === nodeId || e.b === nodeId);
  return { devices, links, blockers: [...problems], nextData };
}

export function subnetRemovalImpact(subnetId, data) {
  const members = data.nodes.filter((n) => data.addressing?.[n.id]?.subnetId === subnetId);
  const memberIds = new Set(members.map((n) => n.id));
  const links = data.edges
    .filter((e) => memberIds.has(e.a) || memberIds.has(e.b))
    .map((e) => ({ id: e.id, label: edgeLabel(e, data), note: '关联设备登记在该网段' }));
  return {
    devices: members.map((n) => ({ id: n.id, name: n.name, note: '已登记在此网段，删除前需先迁移' })),
    links,
    blockers: members.length ? [`网段内仍有 ${members.length} 台设备，请先将其迁移到其他网段`] : [],
  };
}

// 应用影响对话框中填写的路由标记。
export function applyRouteUpdates(data, routeUpdates) {
  if (!routeUpdates || !Object.keys(routeUpdates).length) return data;
  return { ...data, edges: data.edges.map((e) => (routeUpdates[e.id] !== undefined ? { ...e, route: routeUpdates[e.id] } : e)) };
}
