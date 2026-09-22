// validation.js — 校验规则模块
// 集中实现网段与地址规划的所有规则，界面模块只调用这里的函数，不自行判定。
// 所有变更走“候选规划 -> 校验 -> 接受/拒绝”的流程；拒绝时调用方保留原值。

import {
  cidrContainsIp,
  cidrHosts,
  cidrOverlap,
  edgeKey,
  findNode,
  findSubnet,
  ipToInt,
  isValidIp,
  isValidVlan,
  parseCidr,
  sameSubnet,
} from './addressing.js';

// 级别：error 必须修复；warning 仅提示（如孤立节点）
export function validatePlan(plan) {
  const issues = [];

  // ---- 网段自身 ----
  const cidrOwner = new Map();
  for (const s of plan.subnets) {
    const c = parseCidr(s.cidr);
    if (!c) {
      issues.push({ level: 'error', scope: 'subnet', id: s.id, code: 'CIDR_INVALID', message: `网段「${s.name}」的 CIDR ${s.cidr} 不合法` });
    } else if (!isValidVlan(s.vlan)) {
      issues.push({ level: 'error', scope: 'subnet', id: s.id, code: 'VLAN_INVALID', message: `网段「${s.name}」的 VLAN ${s.vlan} 不在 1-4094` });
    } else if (!isValidIp(s.gateway)) {
      issues.push({ level: 'error', scope: 'subnet', id: s.id, code: 'GATEWAY_INVALID', message: `网段「${s.name}」的网关 ${s.gateway || '(空)'} 不是合法 IP` });
    } else if (!cidrContainsIp(s.cidr, s.gateway)) {
      issues.push({ level: 'error', scope: 'subnet', id: s.id, code: 'GATEWAY_OUTSIDE', message: `网段「${s.name}」的网关 ${s.gateway} 不在 ${s.cidr} 内` });
    }
    if (c) {
      const canon = `${c.network}/${c.prefix}`;
      const prev = cidrOwner.get(canon);
      if (prev) {
        issues.push({ level: 'error', scope: 'subnet', id: s.id, code: 'SUBNET_DUP', message: `网段「${s.name}」与「${prev.name}」地址段完全相同` });
      } else {
        cidrOwner.set(canon, s);
      }
    }
  }
  // 网段重叠（两两比较，跳过已登记的完全相同）
  for (let i = 0; i < plan.subnets.length; i++) {
    for (let j = i + 1; j < plan.subnets.length; j++) {
      const a = plan.subnets[i];
      const b = plan.subnets[j];
      if (parseCidr(a.cidr) && parseCidr(b.cidr) && a.cidr !== b.cidr && cidrOverlap(a.cidr, b.cidr)) {
        issues.push({ level: 'error', scope: 'subnet', id: a.id, code: 'SUBNET_OVERLAP', message: `网段「${a.name}」(${a.cidr}) 与「${b.name}」(${b.cidr}) 地址重叠` });
      }
    }
    // VLAN 重复
    const a = plan.subnets[i];
    if (isValidVlan(a.vlan) && plan.subnets.some((b, j) => j !== i && isValidVlan(b.vlan) && Number(b.vlan) === Number(a.vlan))) {
      issues.push({ level: 'error', scope: 'subnet', id: a.id, code: 'VLAN_DUP', message: `网段「${a.name}」的 VLAN ${a.vlan} 与其他网段冲突` });
    }
  }

  // ---- 设备地址 ----
  const seenIp = new Map(); // subnetId|ip -> node
  for (const n of plan.nodes) {
    const subnet = findSubnet(plan, n.subnetId);
    if (!subnet) {
      issues.push({ level: 'error', scope: 'node', id: n.id, code: 'SUBNET_MISSING', message: `设备「${n.name}」未登记网段` });
      continue;
    }
    if (!isValidIp(n.ip)) {
      issues.push({ level: 'error', scope: 'node', id: n.id, code: 'IP_INVALID', message: `设备「${n.name}」的 IP ${n.ip || '(空)'} 不合法` });
      continue;
    }
    if (!cidrContainsIp(subnet.cidr, n.ip)) {
      issues.push({ level: 'error', scope: 'node', id: n.id, code: 'IP_OUT_OF_RANGE', message: `设备「${n.name}」的 ${n.ip} 越界，不属于 ${subnet.name} ${subnet.cidr}` });
    } else {
      const { count, first, last } = cidrHosts(subnet.cidr);
      const v = ipToInt(n.ip);
      if (count > 0 && (v < first || v > last)) {
        issues.push({ level: 'error', scope: 'node', id: n.id, code: 'IP_RESERVED', message: `设备「${n.name}」的 ${n.ip} 是网络/广播保留地址` });
      }
      const key = `${n.subnetId}|${n.ip}`;
      const prev = seenIp.get(key);
      if (prev) {
        issues.push({ level: 'error', scope: 'node', id: n.id, code: 'IP_DUPLICATE', message: `设备「${n.name}」与「${prev.name}」在 ${subnet.name} 内重复使用 ${n.ip}` });
      } else {
        seenIp.set(key, n);
      }
    }
  }

  // ---- 连线 ----
  const seenEdge = new Set();
  for (const e of plan.edges) {
    const a = findNode(plan, e.a);
    const b = findNode(plan, e.b);
    if (!a || !b) {
      issues.push({ level: 'error', scope: 'edge', id: e.id, code: 'EDGE_BROKEN', message: '存在悬空连线（端点设备已不存在）' });
      continue;
    }
    const k = edgeKey(e.a, e.b);
    if (seenEdge.has(k)) {
      issues.push({ level: 'error', scope: 'edge', id: e.id, code: 'EDGE_DUP', message: `「${a.name}」与「${b.name}」之间存在重复连线` });
    }
    seenEdge.add(k);
    const same = sameSubnet(plan, e.a, e.b);
    if (same === false && !e.routed) {
      issues.push({ level: 'error', scope: 'edge', id: e.id, code: 'ROUTE_MISSING', message: `跨网段连线「${a.name} ↔ ${b.name}」未标明路由` });
    }
  }

  // ---- 孤立节点（仅提示） ----
  const linked = new Set(plan.edges.flatMap((e) => [e.a, e.b]));
  for (const n of plan.nodes) {
    if (!linked.has(n.id)) {
      issues.push({ level: 'warning', scope: 'node', id: n.id, code: 'ISOLATED', message: `设备「${n.name}」没有任何连线` });
    }
  }

  return { issues, valid: !issues.some((i) => i.level === 'error') };
}

export function issuesFor(plan, scope, id) {
  return validatePlan(plan).issues.filter((i) => i.scope === scope && i.id === id);
}

// 对候选规划做整体校验，返回 {ok, plan, issues}。
// ok=false 时调用方必须保留原值（本函数不修改入参）。
export function commitPlan(plan) {
  const result = validatePlan(plan);
  return { ok: result.valid, plan, issues: result.issues };
}

// 变更前预检：仅返回与“本次改动直接相关”的错误，便于界面给出精确提示。
export function previewChange(current, producer) {
  const candidate = producer(structuredClone(current));
  const { issues } = validatePlan(candidate);
  return { candidate, issues: issues.filter((i) => i.level === 'error') };
}

// ---- 影响面分析：删除设备 / 调整网段或 VLAN 前调用 ----

export function impactRemoveNode(plan, nodeId) {
  const node = findNode(plan, nodeId);
  if (!node) return null;
  const edges = plan.edges.filter((e) => e.a === nodeId || e.b === nodeId);
  const peerNodes = edges.map((e) => findNode(plan, e.a === nodeId ? e.b : e.a)).filter(Boolean);
  return {
    kind: 'remove-node',
    node,
    edges,
    peerNodes,
    lines: [
      `将删除设备「${node.name}」(${node.ip || '未配置 IP'})`,
      ...(edges.length
        ? [`同时移除 ${edges.length} 条连线：` + peerNodes.map((p) => `「${p.name}」`).join('、')]
        : ['该设备当前没有连线']),
    ],
  };
}

export function impactRemoveSubnet(plan, subnetId) {
  const subnet = findSubnet(plan, subnetId);
  if (!subnet) return null;
  const nodes = plan.nodes.filter((n) => n.subnetId === subnetId);
  const nodeIds = new Set(nodes.map((n) => n.id));
  // 涉及成员设备、以及成员设备参与的全部连线（含跨网段连线）
  const edges = plan.edges.filter((e) => nodeIds.has(e.a) || nodeIds.has(e.b));
  return {
    kind: 'remove-subnet',
    subnet,
    nodes,
    edges,
    lines: [
      `将删除网段「${subnet.name}」(${subnet.cidr}，VLAN ${subnet.vlan})`,
      nodes.length ? `网段内 ${nodes.length} 台设备将失去网段登记：${nodes.map((n) => `「${n.name}」`).join('、')}` : '网段内没有设备',
      edges.length ? `受影响连线 ${edges.length} 条（成员设备的全部连线将一并移除）` : '没有受影响连线',
    ],
  };
}

export function impactEditSubnet(plan, subnetId, patch) {
  const subnet = findSubnet(plan, subnetId);
  if (!subnet) return null;
  const next = { ...subnet, ...patch };
  const nodes = plan.nodes.filter((n) => n.subnetId === subnetId);

  const affectedNodes = [];
  for (const n of nodes) {
    const reasons = [];
    const cidrChanged = next.cidr !== subnet.cidr;
    if (cidrChanged) {
      if (!isValidIp(n.ip) || !cidrContainsIp(next.cidr, n.ip)) reasons.push(`IP ${n.ip} 不在新网段 ${next.cidr} 内`);
      else {
        const { count, first, last } = cidrHosts(next.cidr);
        const v = ipToInt(n.ip);
        if (count > 0 && (v < first || v > last)) reasons.push(`IP ${n.ip} 落入网络/广播保留段`);
      }
    }
    if (next.gateway !== subnet.gateway && next.gateway === n.ip) reasons.push('该设备地址将成为新网关');
    if (reasons.length) affectedNodes.push({ node: n, reasons });
  }

  // VLAN 变化影响：跨网段连线本身不受 VLAN 影响，但同 VLAN 冲突会牵连其他网段
  const vlanConflicts =
    isValidVlan(next.vlan) && next.vlan !== subnet.vlan
      ? plan.subnets.filter((s) => s.id !== subnetId && isValidVlan(s.vlan) && Number(s.vlan) === Number(next.vlan))
      : [];

  // 网段范围变化后，跨网段连线状态可能翻转（新范围覆盖了对端 IP 则变为同网段）
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = plan.edges.filter((e) => nodeIds.has(e.a) || nodeIds.has(e.b));
  const affectedEdges = [];
  for (const e of edges) {
    const wasCross = findNode(plan, e.a)?.subnetId !== findNode(plan, e.b)?.subnetId;
    const willCross = (() => {
      const na = findNode(plan, e.a);
      const nb = findNode(plan, e.b);
      const sa = na?.subnetId === subnetId ? next : findSubnet(plan, na?.subnetId);
      const sb = nb?.subnetId === subnetId ? next : findSubnet(plan, nb?.subnetId);
      return sa?.id !== sb?.id;
    })();
    if (wasCross !== willCross) {
      affectedEdges.push({ edge: e, becomesCross: willCross });
    }
  }

  const lines = [
    `将调整网段「${subnet.name}」`,
    ...(patch.cidr && patch.cidr !== subnet.cidr ? [`CIDR：${subnet.cidr} → ${patch.cidr}`] : []),
    ...(patch.gateway !== undefined && patch.gateway !== subnet.gateway ? [`网关：${subnet.gateway} → ${patch.gateway}`] : []),
    ...(patch.vlan !== undefined && Number(patch.vlan) !== Number(subnet.vlan) ? [`VLAN：${subnet.vlan} → ${patch.vlan}`] : []),
    affectedNodes.length ? `受影响设备 ${affectedNodes.length} 台：` + affectedNodes.map((x) => `「${x.node.name}」(${x.reasons.join('，')})`).join('；') : '网段内设备地址不受影响',
    vlanConflicts.length ? `VLAN ${next.vlan} 与网段「${vlanConflicts.map((s) => s.name).join('、')}」冲突` : null,
    affectedEdges.length ? `连线网段归属变化 ${affectedEdges.length} 条` : null,
  ].filter(Boolean);

  return { kind: 'edit-subnet', subnet, next, affectedNodes, vlanConflicts, affectedEdges, lines };
}
