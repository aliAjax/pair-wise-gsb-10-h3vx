import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DEVICE_TYPES, autoAddress, firstSubnetWithSpace, load, persist } from '../addressing/model.js';
import { computeUsage } from '../addressing/availability.js';
import { isCrossSubnet, subnetOf, validateAll, validateDeviceAddress } from '../addressing/validation.js';
import { applyRouteUpdates, deviceMoveImpact, deviceRemovalImpact, subnetChangeImpact } from '../addressing/impact.js';
import Canvas, { ICONS } from './Canvas.jsx';
import Inspector from './Inspector.jsx';
import SubnetDialog from './SubnetDialog.jsx';
import ImpactDialog from './ImpactDialog.jsx';
import IssuesModal from './IssuesModal.jsx';

export default function App() {
  const [data, setData] = useState(load);
  const [selected, setSelected] = useState('gw');
  const [tool, setTool] = useState('select');
  const [notice, setNotice] = useState(null);
  const [drag, setDrag] = useState(null);
  const [pending, setPending] = useState(null);
  const [subnetDialog, setSubnetDialog] = useState(null);
  const [issues, setIssues] = useState(null);
  const board = useRef();

  useEffect(() => persist(data), [data]);
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  // 可用地址随拓扑每次变化重新计算
  const usage = useMemo(() => computeUsage(data), [data]);

  const notify = (text) => setNotice({ text, kind: '' });
  const notifyError = (text) => setNotice({ text, kind: 'error' });

  const node = data.nodes.find((n) => n.id === selected) || null;

  const updateNode = (key, value) =>
    setData((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === selected ? { ...n, [key]: value } : n)) }));

  // 地址资料变更：先校验，不通过则拒绝并保留原值
  const commitAddr = (patch) => {
    if (!node) return false;
    const candidate = { ...data.addressing[node.id], ...patch };
    const found = validateDeviceAddress(node.id, candidate, data);
    if (found.length) {
      notifyError(`已拒绝变更：${found[0].message}`);
      return false;
    }
    setData((d) => ({ ...d, addressing: { ...d.addressing, [node.id]: candidate } }));
    notify('地址资料已更新');
    return true;
  };

  const commitName = (v) => {
    if (!v) {
      notifyError('设备名称不能为空，已保留原值');
      return false;
    }
    updateNode('name', v);
    return true;
  };

  // 调整设备网段：先列出受影响设备与连线，确认后应用
  const commitSubnet = (nodeId, subnetId) => {
    const cur = data.addressing[nodeId];
    if (cur?.subnetId === subnetId) return;
    const sub = data.subnets.find((s) => s.id === subnetId);
    const nextAddr = autoAddress(data, subnetId, nodeId);
    if (!nextAddr) {
      notifyError(`网段「${sub?.name}」可用地址不足，已保留原值`);
      return;
    }
    const target = data.nodes.find((n) => n.id === nodeId);
    const impact = deviceMoveImpact(nodeId, nextAddr, data);
    setPending({
      title: `调整「${target?.name}」的网段`,
      intro: `将登记到「${sub?.name}」（${nextAddr.ip} · 网关 ${nextAddr.gateway} · VLAN ${nextAddr.vlan}），确认后应用。`,
      impact,
      onConfirm: (routes) => {
        setData(applyRouteUpdates(impact.nextData, routes));
        notify('网段调整已应用');
      },
    });
  };

  // 移除设备：先列出受影响设备与连线，确认后删除
  const askRemoveDevice = (nodeId) => {
    const target = data.nodes.find((n) => n.id === nodeId);
    const impact = deviceRemovalImpact(nodeId, data);
    setPending({
      title: `删除设备「${target?.name}」`,
      intro: '删除前请确认以下受影响的设备与连线。',
      impact,
      confirmLabel: '确认删除',
      onConfirm: () => {
        setData((d) => {
          const addressing = { ...d.addressing };
          delete addressing[nodeId];
          return {
            ...d,
            nodes: d.nodes.filter((n) => n.id !== nodeId),
            edges: d.edges.filter((e) => e.a !== nodeId && e.b !== nodeId),
            addressing,
          };
        });
        setSelected((sel) => (sel === nodeId ? null : sel));
        notify('设备已删除，地址已释放回网段');
      },
    });
  };

  // 新增设备：自动登记网段、IP、网关与 VLAN
  const addNode = (type, label) => {
    const id = 'node' + Date.now();
    const sub = firstSubnetWithSpace(data);
    const addressing = { ...data.addressing };
    if (sub) addressing[id] = autoAddress(data, sub.id);
    setData((d) => ({ ...d, nodes: [...d.nodes, { id, name: label, type, x: 500, y: 300 }], addressing }));
    setSelected(id);
    setTool('select');
    if (sub) notify(`已添加设备并登记地址 ${addressing[id].ip}（${sub.name}）`);
    else notifyError('已添加设备，但网段可用地址不足，请新建网段后为其登记地址');
  };

  const connect = () => {
    if (!selected) return;
    const other = prompt('输入要连接的设备 ID（例如 sw1）');
    if (!other) return;
    if (other === selected) return notifyError('不能连接设备自身');
    if (!data.nodes.some((n) => n.id === other)) return notifyError(`设备 ${other} 不存在`);
    if (data.edges.some((e) => (e.a === selected && e.b === other) || (e.a === other && e.b === selected))) {
      return notifyError('连线已存在');
    }
    const edge = { id: 'e' + Date.now(), a: selected, b: other, route: '' };
    if (isCrossSubnet(edge, data)) {
      const aName = data.nodes.find((n) => n.id === selected)?.name;
      const bName = data.nodes.find((n) => n.id === other)?.name;
      const far = subnetOf(data, other);
      const route = prompt(`「${aName}」与「${bName}」为跨网段连线，请输入路由标记（如 via ${far?.gateway || '网关'}）`);
      if (!route || !route.trim()) return notifyError('跨网段连线未标明路由，已拒绝变更');
      edge.route = route.trim();
    }
    setData((d) => ({ ...d, edges: [...d.edges, edge] }));
    notify('连接已创建');
  };

  const removeEdge = (edgeId) => {
    setData((d) => ({ ...d, edges: d.edges.filter((e) => e.id !== edgeId) }));
    notify('连线已删除');
  };

  const commitRoute = (edgeId, route) => {
    const edge = data.edges.find((e) => e.id === edgeId);
    if (!edge) return false;
    if (isCrossSubnet(edge, data) && !route.trim()) {
      notifyError('跨网段连线需标明路由，已保留原值');
      return false;
    }
    setData((d) => ({ ...d, edges: d.edges.map((e) => (e.id === edgeId ? { ...e, route: route.trim() } : e)) }));
    notify('路由标记已更新');
    return true;
  };

  const check = () => {
    const found = validateAll(data);
    if (found.length) {
      setIssues(found);
      notifyError(`发现 ${found.length} 项校验问题`);
    } else {
      notify('校验通过：地址资料与连线均符合规则');
    }
  };

  // 导出只写校验通过的内容
  const exportJson = () => {
    const found = validateAll(data);
    if (found.length) {
      setIssues(found);
      notifyError(`校验未通过（${found.length} 项），导出已取消`);
      return;
    }
    const payload = {
      meta: {
        generator: 'NETSCAPE 网段与地址规划台',
        exportedAt: new Date().toISOString(),
        devices: data.nodes.length,
        links: data.edges.length,
        subnets: data.subnets.length,
      },
      subnets: data.subnets,
      nodes: data.nodes,
      edges: data.edges,
      addressing: data.addressing,
      availability: data.subnets.map((s) => {
        const u = usage[s.id] || {};
        return {
          subnet: s.name,
          cidr: s.cidr,
          vlan: Number(s.vlan),
          total: u.total ?? 0,
          used: u.used ?? 0,
          free: u.free ?? 0,
          nextAvailable: u.next ?? null,
        };
      }),
      validation: {
        passed: true,
        checkedAt: new Date().toISOString(),
        rules: ['同网段重复 IP', '地址越界', '网关不在网段', '跨网段连线需标明路由', 'VLAN 与网段一致', '网段不重叠'],
      },
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    a.download = 'network-topology.json';
    a.click();
    notify('校验通过，JSON 已导出');
  };

  const save = () => {
    persist(data);
    notify('拓扑与地址资料已保存');
  };

  const submitSubnet = (form, routes) => {
    const clean = { name: form.name.trim(), cidr: form.cidr.trim(), gateway: form.gateway.trim(), vlan: Number(form.vlan) };
    if (subnetDialog.mode === 'create') {
      const id = 'subnet' + Date.now();
      setData((d) => ({ ...d, subnets: [...d.subnets, { id, ...clean }] }));
      notify(`网段「${clean.name}」已创建`);
    } else {
      const impact = subnetChangeImpact(subnetDialog.subnetId, clean, data);
      setData(applyRouteUpdates(impact.nextData, routes));
      notify(`网段「${clean.name}」已更新，受影响设备与连线已同步`);
    }
    setSubnetDialog(null);
  };

  const deleteSubnet = () => {
    const sub = data.subnets.find((s) => s.id === subnetDialog.subnetId);
    setData((d) => ({ ...d, subnets: d.subnets.filter((s) => s.id !== subnetDialog.subnetId) }));
    setSubnetDialog(null);
    notify(`网段「${sub?.name}」已删除`);
  };

  const move = (e) => {
    if (!drag) return;
    const r = board.current.getBoundingClientRect();
    setData((d) => ({
      ...d,
      nodes: d.nodes.map((n) =>
        n.id === drag ? { ...n, x: Math.max(35, e.clientX - r.left), y: Math.max(35, e.clientY - r.top) } : n,
      ),
    }));
  };

  const inspectorHandlers = {
    onCommitName: commitName,
    onCommitType: (v) => updateNode('type', v),
    onCommitSubnet: commitSubnet,
    onCommitIp: (v) => commitAddr({ ip: v }),
    onCommitGateway: (v) => commitAddr({ gateway: v }),
    onCommitVlan: (v) => {
      const num = Number(v);
      return commitAddr({ vlan: v.trim() !== '' && Number.isInteger(num) ? num : v });
    },
    onCommitRoute: commitRoute,
    onRemoveEdge: removeEdge,
    onRemoveNode: askRemoveDevice,
    onConnect: connect,
  };

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="brand-mark">⌁</span>
          <div><strong>NETSCAPE</strong><small>网段与地址规划台</small></div>
        </div>
        <div className="file">
          <span className="dot"></span>
          <div><strong>office-network.json</strong><small>{data.subnets.length} 个网段 · {data.nodes.length} 台设备</small></div>
        </div>
        <div className="top-actions">
          <button onClick={check}>✓ 检查</button>
          <button onClick={exportJson}>↓ 导出</button>
          <button className="save" onClick={save}>保存更改</button>
        </div>
      </header>
      <div className="toolbar">
        <div className="tool-group">
          <span>工具</span>
          <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')}>↖ 选择</button>
          <button className={tool === 'connect' ? 'on' : ''} onClick={() => { setTool('connect'); connect(); }}>⌁ 连接</button>
          <button onClick={() => addNode('device', '新设备')}>＋ 设备</button>
          <button onClick={() => setSubnetDialog({ mode: 'create' })}>＋ 网段</button>
        </div>
        <div className="tool-group zoom">
          <button>−</button><span>100%</span><button>＋</button>
          <button onClick={() => notify('画布已居中')}>⌗</button>
        </div>
      </div>
      <div className="workspace">
        <aside className="inventory">
          <div className="section-title"><span>设备库</span><small>{data.nodes.length} 个节点</small></div>
          <div className="device-types">
            {DEVICE_TYPES.map(([t, i, l]) => (
              <button key={t} onClick={() => addNode(t, l)}><i className={t}>{i}</i>{l}<span>＋</span></button>
            ))}
          </div>
          <div className="section-title nodes-head"><span>网段</span><small>{data.subnets.length} 个</small></div>
          <div className="subnet-list">
            {data.subnets.map((s) => {
              const u = usage[s.id] || { used: 0, total: 0, next: null };
              const pct = u.total > 0 ? Math.min(100, Math.round((u.used / u.total) * 100)) : 0;
              return (
                <button key={s.id} onClick={() => setSubnetDialog({ mode: 'edit', subnetId: s.id })}>
                  <strong>{s.name}<em>VLAN {s.vlan}</em></strong>
                  <small>{s.cidr} · 网关 {s.gateway}</small>
                  <span className="usage"><i style={{ width: pct + '%' }}></i></span>
                  <small>已用 {u.used}/{u.total} · 下一个可用 {u.next || '—'}</small>
                </button>
              );
            })}
          </div>
          <div className="section-title nodes-head"><span>图中节点</span><small>点击查看</small></div>
          <div className="node-list">
            {data.nodes.map((n) => (
              <button className={selected === n.id ? 'sel' : ''} onClick={() => setSelected(n.id)} key={n.id}>
                <i className={n.type}>{ICONS[n.type] || '▱'}</i>
                <span><strong>{n.name}</strong><small>{data.addressing[n.id]?.ip || '未登记'}</small></span>
                <b>›</b>
              </button>
            ))}
          </div>
        </aside>
        <Canvas
          data={data}
          selected={selected}
          onSelect={setSelected}
          onDragStart={setDrag}
          onDragEnd={() => setDrag(null)}
          onMove={move}
          board={board}
        />
        <Inspector node={node} data={data} usage={usage} handlers={inspectorHandlers} />
      </div>
      {notice && <div className={'toast ' + notice.kind}>{notice.text}</div>}
      {pending && (
        <ImpactDialog
          {...pending}
          onCancel={() => setPending(null)}
          onConfirm={(routes) => {
            pending.onConfirm(routes);
            setPending(null);
          }}
        />
      )}
      {subnetDialog && (
        <SubnetDialog
          mode={subnetDialog.mode}
          subnet={data.subnets.find((s) => s.id === subnetDialog.subnetId) || null}
          data={data}
          onSubmit={submitSubnet}
          onDeleteRequest={() => setSubnetDialog({ mode: 'delete', subnetId: subnetDialog.subnetId })}
          onDelete={deleteSubnet}
          onCancel={() => setSubnetDialog(null)}
        />
      )}
      {issues && <IssuesModal issues={issues} onClose={() => setIssues(null)} />}
    </div>
  );
}
