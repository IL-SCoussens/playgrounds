# Run the repository in an Amp orb

Amp runs the executable `.agents/setup` script when it prepares a project
snapshot. Matching snapshots already contain the npm dependencies. Setup uses
the standard orb tools: Node.js, npm, Bun, Git, jq, and the GitHub CLI. The
repository has no toolchain version pins.

To repair dependencies in an existing orb, run:

```sh
.agents/setup
.agents/resume
```

Setup installs from `package-lock.json` with `npm ci`. On a repeated run, it
keeps `node_modules` only when the manifests, Node and npm versions, platform,
and architecture match the last successful install and `npm ls` validates the
dependency tree. It does not authenticate, run `sync.sh`, or start servers.

Resume checks that Next.js is installed and creates an empty `users.json` only
if the file is absent. It preserves existing users and never installs packages
or seeds credentials. Login needs an account provisioned separately. Configure
`JWT_SECRET` through Amp secrets when needed, not in these scripts.

To start the supervised Next.js server and obtain its portal URL, run:

```sh
amp orb services ensure
```

The service checks `/login` for readiness. Use the printed portal URL rather
than a sandbox-local address. Inspect failures with:

```sh
amp orb service logs playgrounds
```

To check a production build, stop the development server first. Both commands
write to `.next`, so running them together can corrupt the build output.

```sh
amp orb service stop playgrounds
npm run build
amp orb services ensure
```

The root app does not define a test script. Bun is already available for
standalone tools such as the index board when their branches are checked out.

These files configure future orbs after they reach the project's default
branch. Local commits alone do not activate them. Setup logs are available at
`~/.cache/amp/logs/setup.log`; resume logs are at
`~/.cache/amp/logs/resume.log`.
