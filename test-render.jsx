import React from 'react';
import { renderToString } from 'react-dom/server';
import App from './src/ui/App.jsx';
import SubnetDialog from './src/ui/SubnetDialog.jsx';
import ImpactDialog from './src/ui/ImpactDialog.jsx';
import IssuesModal from './src/ui/IssuesModal.jsx';
import Inspector from './src/ui/Inspector.jsx';
import { createSeed } from './src/addressing/model.js';
import { computeUsage } from './src/addressing/availability.js';
import { deviceRemovalImpact, subnetChangeImpact } from './src/addressing/impact.js';
import { validateAll } from './src/addressing/validation.js';

const seed = createSeed();
const usage = computeUsage(seed);
const noop = () => {};
const handlers = {
  onCommitName: noop, onCommitType: noop, onCommitSubnet: noop, onCommitIp: noop,
  onCommitGateway: noop, onCommitVlan: noop, onCommitRoute: noop, onRemoveEdge: noop,
  onRemoveNode: noop, onConnect: noop,
};

const checks = [
  ['App', <App />, 'NETSCAPE'],
  ['App 含网段列表', <App />, '办公网段 A'],
  ['Inspector 已登记', <Inspector node={seed.nodes[3]} data={seed} usage={usage} handlers={handlers} />, '10.0.1.10'],
  ['Inspector 未选择', <Inspector node={null} data={seed} usage={usage} handlers={handlers} />, '选择一个设备'],
  ['SubnetDialog edit', <SubnetDialog mode="edit" subnet={seed.subnets[1]} data={seed} onSubmit={noop} onDelete={noop} onDeleteRequest={noop} onCancel={noop} />, '受影响设备'],
  ['SubnetDialog delete', <SubnetDialog mode="delete" subnet={seed.subnets[1]} data={seed} onSubmit={noop} onDelete={noop} onDeleteRequest={noop} onCancel={noop} />, '确认删除'],
  ['SubnetDialog create', <SubnetDialog mode="create" subnet={null} data={seed} onSubmit={noop} onDelete={noop} onDeleteRequest={noop} onCancel={noop} />, '创建网段'],
  ['ImpactDialog', <ImpactDialog title="删除设备" impact={deviceRemovalImpact('sw1', seed)} onConfirm={noop} onCancel={noop} />, '受影响连线'],
  ['ImpactDialog 需路由', <ImpactDialog title="t" impact={subnetChangeImpact('office-a', { name: 'A', cidr: '10.0.1.0/24', gateway: '10.0.1.1', vlan: 10 }, seed)} onConfirm={noop} onCancel={noop} />, '受影响设备'],
  ['IssuesModal', <IssuesModal issues={validateAll(seed).concat([{ rule: 'ip-duplicate', message: 'x' }])} onClose={noop} />, '校验结果'],
];

let fail = 0;
for (const [name, el, expect] of checks) {
  const html = renderToString(el);
  if (!html.includes(expect)) {
    fail++;
    console.log(`FAIL: ${name} 未包含「${expect}」`);
  }
}
console.log(fail ? `${fail} failed` : `render ok (${checks.length} checks)`);
process.exit(fail ? 1 : 0);
