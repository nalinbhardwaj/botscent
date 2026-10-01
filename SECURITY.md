# Security policy

## Reporting

Report a vulnerability privately through this repository's **Security → Report a vulnerability** page, not in a public issue. Include the version, the runtime, and a request, page or input that shows the problem. You will get an answer within three working days.

## What counts

A detection library invites reports that are not vulnerabilities, so this is the line:

- **Not a vulnerability: an agent that evades detection.** That is a coverage report, and it is welcome as an ordinary issue.
- **Handled like a vulnerability, for speed: a person reported as an agent**, anywhere except inside an agent product's own browser. This is the most serious class of bug the library can have; report it privately or publicly, whichever is faster for you.
- **Vulnerabilities:** a verifier that accepts a Web Bot Auth signature it should reject; `isVerified` (`is_verified`) returning true for anything but the request's own verified evidence; anything that lets page content change the server half's verdict; anything that makes the library throw into the host page or the host application.
- **Out of scope:** using an unverified name, an `agent_name` or a reason other than through `isVerified`, as an access control. Names and declarations are claims, and the documentation says so.

## Supported versions

The latest minor release receives fixes. Signer keys are frozen into each release, so staying current also keeps signature verification current.
