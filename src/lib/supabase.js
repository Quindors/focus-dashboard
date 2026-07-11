import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// In local (SQLite) mode there are no Supabase env vars — leave the client null.
// dataSource.js only touches this when VITE_DATA_SOURCE !== 'local'.
export const supabase = url && key ? createClient(url, key) : null
