/*
 * 검토 기준(룰셋) 스토어 — 화면 편집 + 버전 관리.
 * 시스템 기본값(QADOC.DATA.rulesets)으로 시드하고, 이후 편집분은 localStorage에 버전별로 저장.
 * 검토 엔진은 active(type) 의 활성 버전 룰셋을 사용한다 (app.js 가 연결).
 *
 * 저장 구조: qadoc.rules.v1 = {
 *   testcase: { activeVersion: N, versions: [ {version, name, rules, createdAt} ] },
 *   spec:     { ... }
 * }
 */
(function () {
  const QADOC = (window.QADOC = window.QADOC || {});
  const KEY = "qadoc.rules.v1";

  function seed() {
    const o = {};
    (QADOC.DATA.rulesets || []).forEach((rs) => {
      const v = rs.version || 1;
      o[rs.type] = {
        activeVersion: v,
        versions: [{ version: v, name: rs.name, rules: rs.rules, createdAt: new Date().toISOString() }]
      };
    });
    return o;
  }

  function load() {
    let o;
    try {
      o = JSON.parse(localStorage.getItem(KEY));
    } catch (e) {
      o = null;
    }
    if (!o || typeof o !== "object" || Object.keys(o).length === 0) {
      o = seed();
      save(o);
    }
    return o;
  }
  function save(o) {
    localStorage.setItem(KEY, JSON.stringify(o));
  }

  function entry(type) {
    const o = load();
    return o[type] || null;
  }

  QADOC.rules = {
    // 활성 룰셋 (검토 엔진이 사용) — {type, name, version, rules}
    active(type) {
      const t = entry(type);
      if (!t) {
        // 시드에 없는 유형 → DATA 폴백
        const rs = (QADOC.DATA.rulesets || []).find((r) => r.type === type);
        return rs ? { type: type, name: rs.name, version: rs.version || 1, rules: rs.rules } : { type: type, name: "-", version: 1, rules: [] };
      }
      const v = t.versions.find((x) => x.version === t.activeVersion) || t.versions[t.versions.length - 1];
      return { type: type, name: v.name, version: v.version, rules: v.rules };
    },

    versions(type) {
      const t = entry(type);
      if (!t) return [];
      return t.versions
        .slice()
        .sort((a, b) => b.version - a.version)
        .map((v) => Object.assign({ active: v.version === t.activeVersion }, v));
    },

    // 새 버전으로 저장(+활성화)
    saveNewVersion(type, name, rules) {
      const o = load();
      const t = o[type] || { activeVersion: 0, versions: [] };
      const ver = t.versions.reduce((m, v) => Math.max(m, v.version), 0) + 1;
      t.versions.push({ version: ver, name: name || "기준 v" + ver, rules: rules, createdAt: new Date().toISOString() });
      t.activeVersion = ver;
      o[type] = t;
      save(o);
      return this.active(type);
    },

    setActive(type, version) {
      const o = load();
      if (o[type] && o[type].versions.some((v) => v.version === version)) {
        o[type].activeVersion = version;
        save(o);
      }
      return this.active(type);
    },

    // 시스템 기본값으로 초기화(현재 유형)
    resetToDefault(type) {
      const o = load();
      const rs = (QADOC.DATA.rulesets || []).find((r) => r.type === type);
      if (!rs) return null;
      const ver = (o[type] ? o[type].versions.reduce((m, v) => Math.max(m, v.version), 0) : 0) + 1;
      const t = o[type] || { versions: [] };
      t.versions.push({ version: ver, name: rs.name + " (기본 복원)", rules: rs.rules, createdAt: new Date().toISOString() });
      t.activeVersion = ver;
      o[type] = t;
      save(o);
      return this.active(type);
    }
  };
})();
