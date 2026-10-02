Created with the AWS CLI, all tagged project=botscent, purpose=plan-4.4-deploytest:

- cache policy `botscent-deploytest-honor`: MinTTL 0, DefaultTTL 0, MaxTTL 3600 (honours the origin's Cache-Control);
- cache policy `botscent-deploytest-forced`: MinTTL 60, DefaultTTL 60 (a minimum TTL above zero overrides no-store);
- response headers policy `botscent-deploytest-server-timing`: ServerTimingHeadersConfig enabled, sampling 100;
- origin request policy: the managed `Managed-AllViewerExceptHostHeader`;
- a distribution with the deployment of `origin/` as its origin: `/*` honour, `/forced/*` forced, `/plain/*` forced without the Server-Timing policy;
- a second distribution with `examples/next` under `next start` as its origin, caching its HTML.
