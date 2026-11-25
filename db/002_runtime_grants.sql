-- Only the server login accesses authentication state. It is not a business-table owner.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA auth FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA auth,public TO growth_app;
GRANT SELECT ON auth.users TO growth_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON auth.sessions,auth.login_attempts TO growth_app;
REVOKE ALL ON auth.schema_migrations FROM PUBLIC,anon,authenticated,growth_app;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM growth_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM growth_app;
GRANT USAGE ON SCHEMA public TO authenticated;
