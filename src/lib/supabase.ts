import { createClient } from '@supabase/supabase-js';

// URL projekta in ključ "publishable" sta javna po zasnovi (vidna v vsakem brskalniku).
// Podatke varujejo pravila RLS v bazi. Tajni ključ (secret / service_role) NIKOLI sem.
const SUPABASE_URL = 'https://ghovfrslfajbebhyszsd.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_iOumUPzoWkYfTULmqc0RqQ_VTJMrcKM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
