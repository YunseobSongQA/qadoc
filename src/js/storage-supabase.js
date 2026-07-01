/*
 * Supabase 저장소 어댑터 (Phase 4b) — provider 교체형 저장소의 "원격" 구현.
 *
 * [주의] 현재 기본 저장소는 storage.js(localStorage, 동기)입니다. 파일럿 무가입 체험을 유지하기 위함.
 *    이 어댑터는 동일한 "논리적 인터페이스"를 async 로 제공합니다. 실제 전환(app.js의 storage
 *    호출을 await 로 바꾸는 작업)은 4b 단계에서 진행합니다. 지금은 설정 시 로드되는 참조 구현입니다.
 *
 * 키 안전성: SUPABASE_ANON_KEY 는 공개 가능한 키입니다(프론트 노출 OK). 데이터 보호는 RLS가 담당.
 *            서비스 롤 키는 절대 프론트에 두지 마세요.
 *
 * 사용: index.html 에서 supabase-js(CDN)와 config.js 로드 후 이 파일 로드.
 *   window.QADOC_CONFIG = { SUPABASE_URL, SUPABASE_ANON_KEY }
 */
(function () {
  const QADOC = (window.QADOC = window.QADOC || {});
  const cfg = window.QADOC_CONFIG || {};

  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) {
    // 설정/SDK 없으면 어댑터를 노출하지 않음 → 앱은 localStorage(storage.js) 그대로 사용
    return;
  }

  const client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  async function uid() {
    const { data } = await client.auth.getUser();
    return data && data.user ? data.user.id : null;
  }

  // DB row → 앱 공통 형태 (localStorage(storage.js)와 동일한 키)
  function mapDoc(row) {
    if (!row) return row;
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      presetId: row.preset_id,
      currentVersion: row.current_version,
      content: row.content || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
  function mapPreset(row) {
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      fields: row.schema,
      is_system: row.is_system,
      _remote: true
    };
  }

  QADOC.storageSupabase = {
    client: client,

    // ── 인증 (파일럿: 이메일 매직링크 — 비밀번호 없음) ──
    async signIn(email) {
      const { error } = await client.auth.signInWithOtp({ email });
      if (error) throw error;
    },
    async signOut() {
      await client.auth.signOut();
    },
    async currentUser() {
      const { data } = await client.auth.getUser();
      return data ? data.user : null;
    },

    // ── 문서 (storage.js 와 동일한 논리적 인터페이스, async) ──
    async listDocuments() {
      const { data, error } = await client
        .from("documents")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapDoc);
    },

    async getDocument(id) {
      const { data, error } = await client.from("documents").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return mapDoc(data);
    },

    async saveDocument(doc) {
      const owner = await uid();
      if (doc.id) {
        // 기존 내용을 버전 이력으로 적립 후 갱신
        const prev = await this.getDocument(doc.id);
        if (prev) {
          await client.from("document_versions").insert({
            document_id: prev.id,
            version: prev.current_version || 1,
            content: prev.content
          });
        }
        const { data, error } = await client
          .from("documents")
          .update({
            title: doc.title,
            content: doc.content,
            preset_id: doc.presetId,
            current_version: (prev ? prev.current_version || 1 : 1) + 1,
            updated_at: new Date().toISOString()
          })
          .eq("id", doc.id)
          .select()
          .single();
        if (error) throw error;
        return mapDoc(data);
      }
      const { data, error } = await client
        .from("documents")
        .insert({
          owner_id: owner,
          type: doc.type,
          preset_id: doc.presetId,
          title: doc.title,
          content: doc.content,
          current_version: 1
        })
        .select()
        .single();
      if (error) throw error;
      return mapDoc(data);
    },

    async deleteDocument(id) {
      const { error } = await client.from("documents").delete().eq("id", id);
      if (error) throw error;
    },

    async getVersions(id) {
      const { data, error } = await client
        .from("document_versions")
        .select("*")
        .eq("document_id", id)
        .order("version", { ascending: false });
      if (error) throw error;
      return (data || []).map((r) => ({ version: r.version, content: r.content, savedAt: r.created_at }));
    },

    // ── 프리셋 ──
    async listUserPresets() {
      // 시스템 기본 프리셋은 프론트 DATA 에 이미 있으므로, 여기선 사용자/원격 프리셋만
      const { data, error } = await client.from("presets").select("*").eq("is_system", false);
      if (error) throw error;
      return (data || []).map(mapPreset);
    },
    async addUserPreset(preset) {
      const owner = await uid();
      const { error } = await client.from("presets").insert({
        type: preset.type,
        name: preset.name,
        schema: preset.fields,
        owner_id: owner
      });
      if (error) throw error;
    },

    // ── 검토 결과 저장(선택) ──
    async saveReview(documentId, result) {
      await client.from("reviews").insert({
        document_id: documentId,
        kind: result.kind,
        provider: result.provider || null,
        findings: result.findings || []
      });
    }
  };
})();
