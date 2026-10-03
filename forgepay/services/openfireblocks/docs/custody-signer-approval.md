# Per-signer cryptographic approval

**Built and tested** (unit tests, and an integration test against a real Postgres with the real schema and service).
**Not built:** a browser or hardware-token (WebAuthn/FIDO) signing flow. Today a signer signs with a command-line tool on their own
machine and pastes the result into the console, which is workable but not pleasant.

## What problem it solves

A "vote" used to mean the console said so. The console authenticated the person and told the gateway who they were, so whoever
controlled the console, or held its secrets, could cast any signer's vote. Now each signer has their **own Ed25519 key**, kept
off the console and off the gateway. A vote counts only with that signer's signature over the exact proposal. A compromised
console or gateway can withhold or replay valid votes, but cannot create an approval.

## How it works

- **Enrolment.** A signer's public key is registered with a *proof of possession*: a signature, by that key, over "this key
  belongs to this email in this workspace". The first signer enrols when bootstrapped; later signers enrol inside the `add_signer`
  proposal (which the existing signers vote on, signed). A signer without a key, or who lost theirs, is given a new one through a
  `set_signer_key` proposal that also needs a quorum.
- **A vote** is the signer's signature over: workspace, proposal id, proposal kind, a digest of the payload (and request id), and
  the decision (approve or reject). A signature for "reject" cannot be turned into "approve"; one for proposal A cannot be used on B;
  one for a payload that was edited afterwards no longer verifies.
- **Counting.** The gateway checks each signature when the vote arrives **and again when the quorum is counted**. A vote row
  written straight into the database, or made on a payload that was later changed, counts for nothing, for or against.
- **Proposing** no longer counts as the proposer's own approval when signatures are required (the signature covers the proposal id,
  which does not exist until it is created); the proposer votes as a second step like everyone else.
- **Enforcement.** `CUSTODY_REQUIRE_SIGNER_SIGNATURES` is **on by default in production** and off otherwise (set it to `true` to
  rehearse in staging). When off, a vote with no signature still works as before, and a vote that carries one is still verified.

## For a signer

Everything runs on your own machine; the tool never contacts the gateway or the console.

```
npx tsx scripts/signer-cli.ts keygen --out ~/.forge/me.key           # once; keep it offline and backed up
npx tsx scripts/signer-cli.ts enroll --key ~/.forge/me.key --customer <workspace> --email <you>   # prints publicKey + pop
npx tsx scripts/signer-cli.ts vote   --key ~/.forge/me.key --customer <workspace> --proposal proposal.json --approve
```

`proposal.json` is the proposal as the gateway returned it (the console shows it). The tool **recomputes** the digest from the
payload rather than trusting the one it was handed, **prints in words what you are approving** (destination, amount, any call
data, the signer being added and their key...), and only signs after you type `sign`. If the digest the gateway reported does not
match the payload it refuses and tells you not to sign. In the console, clicking Approve/Reject asks you to paste the signature.

**Read the screen, not the summary someone gave you.** The point of the tool is that you sign what it computed from the payload.

## Limits

- Key custody is the signer's job: a stolen key file is a stolen vote. Use a passphrase-protected disk or a hardware-backed store;
  the CLI does not encrypt the key file (it is mode 0600).
- Losing a key means a `set_signer_key` proposal, which needs the *other* signers; if too many keys are lost, the workspace is stuck.
- The console still sits between the signer and the gateway for transport and for the proposer's identity; it can no longer forge a
  vote, but it can still decline to forward one.
- The signed digest covers the proposal's payload, not the transaction bytes the nodes eventually sign. The signing nodes enforce
  their own limits independently (node policy), and the gateway seals the payload (`CUSTODY_PROPOSAL_SECRET`); a signer who wants
  certainty about the exact transaction should read the payload fields the tool prints.
