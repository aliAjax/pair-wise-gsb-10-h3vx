import React, { useState } from 'react';
import { validateSubnetForm } from '../addressing/validation.js';
import { subnetChangeImpact, subnetRemovalImpact } from '../addressing/impact.js';
import { ImpactSections, routesComplete, collectRoutes } from './ImpactDialog.jsx';

// 网段新建 / 编辑 / 删除对话框：编辑与删除时实时列出受影响设备与连线，确认后才应用。
export default function SubnetDialog({ mode, subnet, data, onSubmit, onDelete, onDeleteRequest, onCancel }) {
  const [form, setForm] = useState(() =>
    subnet
      ? { name: subnet.name, cidr: subnet.cidr, gateway: String(subnet.gateway), vlan: String(subnet.vlan) }
      : { name: '', cidr: '', gateway: '', vlan: '' },
  );
  const [routes, setRoutes] = useState({});
  if (mode !== 'create' && !subnet) return null;
  const isDelete = mode === 'delete';
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const errors = isDelete ? [] : validateSubnetForm(form, data, subnet?.id);
  const impact = isDelete
    ? subnetRemovalImpact(subnet.id, data)
    : mode === 'edit' && errors.length === 0
      ? subnetChangeImpact(subnet.id, { ...form, vlan: Number(form.vlan) }, data)
      : null;
  const missingRoute = impact ? !routesComplete(impact, routes) : false;
  const blocked = isDelete
    ? impact.blockers.length > 0
    : errors.length > 0 || Boolean(impact && (impact.blockers.length > 0 || missingRoute));
  const title = isDelete ? `删除网段「${subnet.name}」` : mode === 'edit' ? `编辑网段「${subnet.name}」` : '新建网段';
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="dialog-intro">
          {isDelete
            ? '删除前请确认以下受影响的设备与连线。'
            : mode === 'edit'
              ? '调整网段参数，下方实时列出受影响的设备与连线，确认后才会应用。'
              : '创建新的网段用于地址规划，网关需落在网段内。'}
        </p>
        {!isDelete && (
          <>
            <label>网段名称<input value={form.name} onChange={set('name')} placeholder="如：办公网段 A" /></label>
            <label>CIDR<input className="mono" value={form.cidr} onChange={set('cidr')} placeholder="如：10.0.1.0/24" /></label>
            <label>网关<input className="mono" value={form.gateway} onChange={set('gateway')} placeholder="如：10.0.1.1" /></label>
            <label>VLAN<input className="mono" value={form.vlan} onChange={set('vlan')} placeholder="1-4094" /></label>
            {errors.length > 0 && (
              <div className="blockers">
                <h4>表单校验</h4>
                {errors.map((er, i) => (
                  <p key={i}>⚠ {er}</p>
                ))}
              </div>
            )}
          </>
        )}
        {impact && (
          <>
            <ImpactSections impact={impact} routes={routes} onRoute={(id, v) => setRoutes((r) => ({ ...r, [id]: v }))} />
            {impact.blockers.length === 0 && missingRoute && (
              <p className="warn">存在跨网段连线未标明路由，填写路由标记后才能应用。</p>
            )}
          </>
        )}
        <div className="dialog-actions">
          {mode === 'edit' && (
            <button className="danger" onClick={onDeleteRequest}>删除网段</button>
          )}
          <button onClick={onCancel}>取消</button>
          {isDelete ? (
            <button className="save" disabled={blocked} onClick={onDelete}>确认删除</button>
          ) : (
            <button className="save" disabled={blocked} onClick={() => onSubmit(form, impact ? collectRoutes(impact, routes) : {})}>
              {mode === 'edit' ? '确认应用' : '创建网段'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
