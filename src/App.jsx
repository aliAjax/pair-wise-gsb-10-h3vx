import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  edgeKey, findNode, findSubnet, nextFreeIp, normalizePlan, seedPlan,
  subnetUsage, uid, parseCidr,
} from './addressing.js';
import {
  validatePlan, impactRemoveNode, impactRemoveSubnet,
} from './validation.js';
import { buildExport, downloadExport } from './exporter.js';
import Toolbar from './components/Toolbar.jsx';
import Inventory from './components/Inventory.jsx';
import Canvas from './components/Canvas.jsx';
import Inspector from './components/Inspector.jsx';
import { ImpactDialog, IssuesDialog, ExportDialog, ConnectDialog } from './components/Modals.jsx';

const STORE_KEY = 'topology';

function load() {
  try {
    return normalizePlan(JSON.parse(localStorage.getItem(STORE_KEY)));
  } catch {
    return normalizePlan(seedPlan);
  }
}

// 与某设备直接相关的规则错误（设备自身 + 其连线）
function errorsAroundNode(plan, errors, nodeId) {
  const edgeIds = new Set(plan.edges.filter((e) => e.a === nodeId || e.b === nodeId).map((e) => e.id));
  return errors.filter(
    (i) => (i.scope === 'node' && i.id === nodeId) || (i.scope === 'edge' && edgeIds.has(i.id)),
  );
}

// 与某网段直接相关的规则错误（网段自身 + 成员设备 + 成员连线）
function errorsAroundSubnet(plan, errors, subnetId) {
  const memberIds = new Set(plan.nodes.filter((n) => n.subnetId === subnetId).map((n) => n.id));
  const edgeIds = new Set(plan.edges.filter((e) => memberIds.has(e.a) || memberIds.has(e.b)).map((e) => e.id));
  return errors.filter(
    (i) =>
      (i.scope === 'subnet' && i.id === subnetId) ||
      (i.scope === 'node' && memberIds.has(i.id)) ||
      (i.scope === 'edge' && edgeIds.has(i.id)),
  );
}

// 只拒绝“本次变更新引入”的错误，与本次改动无关的历史问题不拦截
function newErrors(base, candidate) {
  const baseMsgs = new Set(base.map((i) => i.message));
  return candidate.filter((i) => !baseMsgs.has(i.message));
}

export default function App() {
  const [plan, setPlan] = useState(load);
  const [selected, setSelected] = useState(plan.nodes[0]?.id ?? '');
  const [inspectSubnetId, setInspectSubnetId] = useState(null);
  const [tool, setTool] = useState('select');
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState('ok');
  const [impact, setImpact] = useState(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [exportData, setExportData] = useState(null);
  const [connectReq, setConnectReq] = useState(null);
  const dragRef = useRef(null);
  const toastTimer = useRef(0);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(plan));
  }, [plan]);

  const toast = (msg, kind = 'ok') => {
    setNotice(msg);
    setNoticeKind(kind);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setNotice(''), 3600);
  };

  const validation = useMemo(() => validatePlan(plan), [plan]);
  const errorIssues = validation.issues.filter((i) => i.level === 'error');

  const validationMap = useMemo(() => {
    const map = { subnet: new Map(), node: new Map(), edge: new Map() };
    for (const i of validation.issues) {
      if (i.scope === 'subnet' || i.scope === 'node' || i.scope === 'edge') {
        if (!map[i.scope].has(i.id)) map[i.scope].set(i.id, []);
        map[i.scope].get(i.id).push(i);
      }
    }
    return map;
  }, [validation]);

  const stats = useMemo(() => {
    let freeIps = 0;
    for (const s of plan.subnets) freeIps += subnetUsage(plan, s).free;
    return {
      subnets: plan.subnets.length,
      nodes: plan.nodes.length,
      edges: plan.edges.length,
      freeIps,
      errors: errorIssues.length,
      warnings: validation.issues.filter((i) => i.level === 'warning').length,
    };
  }, [plan, validation]);

  const node = findNode(plan, selected) || null;
  const inspectSubnet = inspectSubnetId ? findSubnet(plan, inspectSubnetId) : null;

  // ---------- 设备变更：地址类变更必须先过校验，否则拒绝并保留原值 ----------
  const commitNode = (nodeId, patch) => {
    const addrPatch = {};
    if ('subnetId' in patch) addrPatch.subnetId = patch.subnetId;
    if ('ip' in patch) addrPatch.ip = String(patch.ip).trim();
    const isAddrChange = Object.keys(addrPatch).length > 0;

    if (!isAddrChange) {
      // 名称 / 类型 / 坐标不涉及地址规则
      setPlan((p) => ({ ...p, nodes: p.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)) }));
      return { ok: true, errors: [] };
    }

    const candidate = {
      ...plan,
      nodes: plan.nodes.map((n) => (n.id === nodeId ? { ...n, ...addrPatch } : n)),
    };
    const before = errorsAroundNode(plan, errorIssues, nodeId);
    const after = errorsAroundNode(candidate, validatePlan(candidate).issues.filter((i) => i.level === 'error'), nodeId);
    const blocked = newErrors(before, after);
    if (blocked.length) {
      toast(`变更被拒绝，已保留原值：${blocked[0].message}`, 'err');
      return { ok: false, errors: blocked };
    }
    setPlan(candidate);
    return { ok: true, errors: [] };
  };

  // ---------- 网段变更：同样先校验；调用方可 dryRun 仅预检 ----------
  const commitSubnet = (subnetId, patch, opts = {}) => {
    const structural = ['cidr', 'gateway', 'vlan'].some((k) => k in patch);
    if (!structural) {
      if (!opts.dryRun) {
        setPlan((p) => ({ ...p, subnets: p.subnets.map((s) => (s.id === subnetId ? { ...s, ...patch } : s)) }));
      }
      return { ok: true, errors: [] };
    }

    const normalized = { ...patch };
    if ('vlan' in normalized) normalized.vlan = normalized.vlan === '' ? '' : Number(normalized.vlan);
    if ('cidr' in normalized) normalized.cidr = String(normalized.cidr).trim();
    if ('gateway' in normalized) normalized.gateway = String(normalized.gateway).trim();

    const candidate = {
      ...plan,
      subnets: plan.subnets.map((s) => (s.id === subnetId ? { ...s, ...normalized } : s)),
    };
    const before = errorsAroundSubnet(plan, errorIssues, subnetId);
    const afterAll = validatePlan(candidate).issues.filter((i) => i.level === 'error');
    const after = errorsAroundSubnet(candidate, afterAll, subnetId);
    const blocked = newErrors(before, after);
    if (blocked.length) {
      if (!opts.dryRun) toast(`调整被拒绝，已保留原值：${blocked[0].message}`, 'err');
      return { ok: false, errors: blocked };
    }
    if (!opts.dryRun) setPlan(candidate);
    return { ok: true, errors: [] };
  };

  // ---------- 添加设备：自动登记网段与空闲 IP ----------
  const addNode = (type) => {
    const target =
      (inspectSubnetId && findSubnet(plan, inspectSubnetId)) ||
      findSubnet(plan, node?.subnetId) ||
      plan.subnets[0];
    if (!target) {
      toast('请先创建网段，再登记设备', 'err');
      return;
    }
    const ip = nextFreeIp(plan, target);
    if (!ip) {
      toast(`网段「${target.name}」可用地址已满，无法登记新设备`, 'err');
      return;
    }
    const id = uid('node');
    const jitter = plan.nodes.length * 17;
    const n = {
      id,
      name: { router: '新路由器', switch: '新交换机', server: '新服务器', device: '新终端' }[type],
      type,
      x: 420 + (jitter % 160) - 80,
      y: 280 + (jitter % 120) - 40,
      subnetId: target.id,
      ip,
    };
    const candidate = { ...plan, nodes: [...plan.nodes, n] };
    if (!validatePlan(candidate).valid) {
      toast('新设备校验未通过，未添加', 'err');
      return;
    }
    setPlan(candidate);
    setSelected(id);
    setInspectSubnetId(null);
    setTool('select');
    toast(`已添加并登记到「${target.name}」：${ip}`);
  };

  // ---------- 添加网段：自动避让现有地址段与 VLAN ----------
  const addSubnet = () => {
    const usedVlans = new Set(plan.subnets.map((s) => Number(s.vlan)).filter(Number.isInteger));
    let vlan = 10;
    while (usedVlans.has(vlan) && vlan < 4094) vlan += 10;
    let probe = plan.subnets.length;
    let cidr = '';
    for (let k = 0; k < 240; k++) {
      const candidateCidr = `10.0.${(probe + k) % 255}.0/24`;
      const overlap = plan.subnets.some((s) => {
        const a = parseCidr(s.cidr);
        const b = parseCidr(candidateCidr);
        return a && b && a.network <= b.broadcast && b.network <= a.broadcast;
      });
      if (!overlap) { cidr = candidateCidr; break; }
    }
    const id = uid('subnet');
    const s = { id, name: `新网段 ${plan.subnets.length + 1}`, cidr, gateway: cidr ? cidr.replace(/0\/24$/, '1') : '', vlan };
    const candidate = { ...plan, subnets: [...plan.subnets, s] };
    if (!validatePlan(candidate).valid) {
      toast('网段创建校验未通过', 'err');
      return;
    }
    setPlan(candidate);
    setInspectSubnetId(id);
    toast('网段已创建，请在右侧完善 CIDR / 网关 / VLAN');
  };

  // ---------- 删除设备 / 网段：先列影响面 ----------
  const requestRemoveNode = (nodeId) => {
    const data = impactRemoveNode(plan, nodeId);
    if (data) setImpact({ type: 'remove-node', data });
  };

  const requestRemoveSubnet = (subnetId) => {
    const data = impactRemoveSubnet(plan, subnetId);
    if (data) setImpact({ type: 'remove-subnet', data });
  };

  const confirmImpact = () => {
    if (!impact) return;
    if (impact.type === 'remove-node') {
      const id = impact.data.node.id;
      setPlan((p) => ({
        ...p,
        nodes: p.nodes.filter((n) => n.id !== id),
        edges: p.edges.filter((e) => e.a !== id && e.b !== id),
      }));
      if (selected === id) setSelected(plan.nodes.find((n) => n.id !== id)?.id ?? '');
      toast('设备及其连线已删除');
    } else if (impact.type === 'remove-subnet') {
      const id = impact.data.subnet.id;
      const memberIds = new Set(plan.nodes.filter((n) => n.subnetId === id).map((n) => n.id));
      const remaining = plan.nodes.filter((n) => !memberIds.has(n.id));
      setPlan((p) => ({
        ...p,
        subnets: p.subnets.filter((s) => s.id !== id),
        nodes: p.nodes.filter((n) => !memberIds.has(n.id)),
        edges: p.edges.filter((e) => !memberIds.has(e.a) && !memberIds.has(e.b)),
      }));
      if (inspectSubnetId === id) setInspectSubnetId(null);
      if (memberIds.has(selected)) setSelected(remaining[0]?.id ?? '');
      toast('网段、网段内设备及相关连线已删除');
    }
    setImpact(null);
  };

  // ---------- 连线：跨网段必须显式标明路由，否则不建立 ----------
  const attemptConnect = (aId, bId, routed) => {
    if (aId === bId) return;
    const exists = plan.edges.some((e) => edgeKey(e.a, e.b) === edgeKey(aId, bId));
    if (exists) {
      toast('两台设备之间已有连线', 'err');
      return;
    }
    const edge = { id: uid('e'), a: aId, b: bId, routed: !!routed };
    const candidate = { ...plan, edges: [...plan.edges, edge] };
    const errs = validatePlan(candidate).issues.filter((i) => i.level === 'error' && i.scope === 'edge' && i.id === edge.id);
    if (errs.length) {
      toast(`连线被拒绝：${errs[0].message}`, 'err');
      return;
    }
    setPlan(candidate);
    toast(routed ? '已建立跨网段连线并标明路由' : '已建立同网段连线');
  };

  const onCanvasClick = (target) => {
    if (target.kind === 'node') {
      if (tool === 'connect' && selected && target.id !== selected) {
        const a = findNode(plan, selected);
        const b = findNode(plan, target.id);
        if (a.subnetId === b.subnetId) {
          attemptConnect(a.id, b.id, false);
        } else {
          setConnectReq({ a: a.id, b: b.id });
        }
        return;
      }
      setSelected(target.id);
      setInspectSubnetId(null);
      return;
    }
    if (target.kind === 'edge') {
      const e = plan.edges.find((x) => x.id === target.id);
      if (!e) return;
      const candidate = { ...plan, edges: plan.edges.map((x) => (x.id === e.id ? { ...x, routed: !x.routed } : x)) };
      const errs = validatePlan(candidate).issues.filter((i) => i.level === 'error' && i.scope === 'edge' && i.id === e.id);
      if (errs.length) {
        toast(`修改被拒绝，已保留原值：${errs[0].message}`, 'err');
      } else {
        setPlan(candidate);
        toast(e.routed ? '已取消该连线的路由标记' : '该连线已标明路由');
      }
    }
  };

  const moveNode = (id, x, y) => {
    setPlan((p) => ({ ...p, nodes: p.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }));
  };

  // ---------- 导出：只写校验通过的内容 ----------
  const requestExport = () => {
    setExportData(buildExport(plan));
  };

  const confirmExport = () => {
    downloadExport(plan);
    setExportData(null);
    const { omitted } = buildExport(plan);
    toast(omitted.length ? `已导出，已跳过 ${omitted.length} 项未通过校验的内容` : '已导出完整地址规划');
  };

  const savedAt = useMemo(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }, [plan]);

  return (
    <div className="app">
      <Toolbar
        tool={tool}
        setTool={setTool}
        onAddSubnet={addSubnet}
        onCheck={() => setIssuesOpen(true)}
        onExport={requestExport}
        onSave={() => { localStorage.setItem(STORE_KEY, JSON.stringify(plan)); toast(`规划已保存（${savedAt}）`); }}
        stats={stats}
        savedAt={savedAt}
      />
      <div className="workspace">
        <Inventory
          plan={plan}
          selected={selected}
          setSelected={(id) => { setSelected(id); setInspectSubnetId(null); }}
          selectedSubnet={inspectSubnetId}
          setSelectedSubnet={setInspectSubnetId}
          onAddNode={addNode}
          onSelectSubnet={(id) => setInspectSubnetId(id)}
          validationMap={validationMap}
        />
        <Canvas
          plan={plan}
          selected={selected}
          setSelected={setSelected}
          dragRef={dragRef}
          onMoveNode={moveNode}
          connectTool={tool === 'connect'}
          onCanvasNodeClick={onCanvasClick}
          edgeErrors={new Set(errorIssues.filter((i) => i.scope === 'edge').map((i) => i.id))}
        />
        <Inspector
          plan={plan}
          node={node}
          subnet={inspectSubnet}
          inspectSubnet={!!inspectSubnet}
          onCommitNode={commitNode}
          onCommitSubnet={commitSubnet}
          onRemove={() => requestRemoveNode(node.id)}
          onRemoveSubnet={requestRemoveSubnet}
          onToggleRouted={(edgeId) => onCanvasClick({ kind: 'edge', id: edgeId })}
          onBack={() => setInspectSubnetId(null)}
        />
      </div>

      {impact && (
        <ImpactDialog
          impact={impact.data}
          onConfirm={confirmImpact}
          onCancel={() => setImpact(null)}
        />
      )}
      {issuesOpen && <IssuesDialog issues={validation.issues} onClose={() => setIssuesOpen(false)} />}
      {exportData && (
        <ExportDialog
          exportData={exportData}
          onConfirm={confirmExport}
          onCancel={() => setExportData(null)}
        />
      )}
      {connectReq && (
        <ConnectDialog
          plan={plan}
          req={connectReq}
          onConfirm={(routed) => {
            attemptConnect(connectReq.a, connectReq.b, routed);
            setConnectReq(null);
          }}
          onCancel={() => setConnectReq(null)}
        />
      )}

      {notice && <div className={`toast ${noticeKind === 'err' ? 'toast-err' : ''}`}>{notice}</div>}
    </div>
  );
}
