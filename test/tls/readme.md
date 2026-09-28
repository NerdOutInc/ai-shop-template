# Local TLS fixtures

These self-signed certificates and private keys belong only to the loopback PostgreSQL protocol fixture. They are public test data, never production credentials. The fixture tests trusted and untrusted CAs and a wrong hostname without contacting a database or external service.

Generate each pair with OpenSSL using `req -x509 -newkey rsa:2048 -nodes -days 3650`, a matching `-subj /CN=...`, and `-addext subjectAltName=DNS:...`. `localhost` must match the test connection; `wrong.invalid` must not. Regenerate before the September 2036 expiry.
