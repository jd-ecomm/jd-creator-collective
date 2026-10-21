// Public settings for the CRM web app.
// The anon key is designed to be public: every table is protected by row level security,
// so it can only read data for signed-in JD staff. Never put the service role key here.
window.CRM_CONFIG = {
  supabaseUrl: 'https://pssvzybdugbfpnfmjqqq.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzc3Z6eWJkdWdiZnBuZm1qcXFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MDUwODEsImV4cCI6MjEwODA4MTA4MX0.iMiPaom0Yl36df0s8WreP3iF7_ymrAtIiIZdB7PCjAs',
  allowedDomains: ['jdcanada.ca', 'jdsports.ca'],
};
