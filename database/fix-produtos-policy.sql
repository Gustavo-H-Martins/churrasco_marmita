-- ═══════════════════════════════════════════════════════════════════
-- Correção: garante a policy de escrita (INSERT/UPDATE/DELETE)
-- na tabela `produtos`. Rode no Supabase > SQL Editor.
-- (A policy de leitura e as da tabela `config` já estão funcionando.)
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE produtos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_write_produtos" ON produtos;
CREATE POLICY "anon_write_produtos" ON produtos FOR ALL USING (true) WITH CHECK (true);
