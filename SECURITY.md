# Security

Energy Dashboard runs inside Home Assistant and only reads data. A security problem can still expose information about your home.

**Please do not report security problems as a public issue.** Use [Report a vulnerability](https://github.com/tlpeter/energy-dashboard/security/advisories/new) (GitHub's private reporting). You will get an answer within a week.

Examples of what to report:

- a way to make the app send any command to Home Assistant that is not on the read-only list in `ha.js`
- a way to reach the app's web page or API from outside Home Assistant ingress
- the Supervisor token or other secrets in logs, the page or the diagnostics file

Only the latest version is supported.
