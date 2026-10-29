// The Pit's notebook, public by design: Supabase's publishable key is meant for pages, and the notebook's own rules
// decide who reads what (projects/the-pit/db/schema.sql). The secret keys never come near this repo.
window.PIT_CONFIG = {
  supabaseUrl: 'https://wewlgoxxpjsrggiesule.supabase.co',
  supabaseKey: 'sb_publishable_1xmjB2JSb-ao6HNP3_YSLg_hqTmRRPX',
  doorUrl: 'https://hectorfsv.app.n8n.cloud/webhook/the-pit',   // orders with no cook running (1 n8n run each)
  vapidPublicKey: 'BKZuY49whGEUnpb5uP6BU_gU11r-0CxoKXrBLVqMEpy0sD4K3OL_MCZxhZKxFpVoLP_p3F3kkqL8e587-he82V8',   // phone alerts: the public half of The Pit's push key (the private half lives in the notebook, n8n only)
};
