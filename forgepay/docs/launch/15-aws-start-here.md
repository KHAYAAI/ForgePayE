# AWS, step by step (for a first-timer)

**17 October 2026.** You have an AWS account and nothing built yet. This takes you from "I can log in" to "a staging copy of the platform that the deploy workflow can reach".
Do one phase, check the result, and only then start the next. If anything looks different from what a step says, **stop and ask** rather than guess: the AWS console changes its screens
often, and a wrong click on a real account can cost money or open a door.

## Four rules before you touch anything

1. **Never paste a password, an access key, a secret key or a recovery code into chat, a ticket or this repository.** You can tell me *what a screen says*; you never need to show me a secret.
2. **Stop using the "root user" after phase 1.** Root is the email-and-password login that can do anything, including close the account. It is for setup and emergencies only.
3. **Turn on MFA (a second login step) before anything else.** An account without it is the commonest way a small company loses its cloud bill and its data.
4. **Money:** the later phases create things that cost money every hour they exist. Set a budget alert first (phase 1) and tear staging down when you are not using it.

## What you are building, and why in this order

```
Phase 1  Secure the account you have        (hours)   MFA, budget alert, no root keys, an admin login that is not root, an audit trail
Phase 2  A separate staging account         (an hour) so mistakes in staging can never touch production, and the bill is separate
Phase 3  Tools on your computer             (an hour) AWS CLI, Terraform, kubectl, Helm; log in with your admin login
Phase 4  Your domain and its certificate    (a day, mostly waiting for DNS)
Phase 5  Plan the staging environment       (a day)   a DRY RUN: read what would be built and what it costs. Nothing is built yet
Phase 6  Build staging                      (a day)   only after we have read the plan together
Phase 7  Let GitHub deploy to it safely     (an hour) the OIDC role and approval gate from docs/launch/14-deploying-services.md
Phase 8  First dry-run deploy               (an hour)
```

**Decisions to make now** (they shape everything after, and some cannot be changed later):

| Decision | My recommendation | Why |
|---|---|---|
| **Region for staging** | **Chosen 28 Oct: `eu-north-1` (Stockholm).** (Recommended was `eu-west-2` (London); both work.) | Every service is available and no opt-in is needed. The repo's scripts also support `af-south-1` (Cape Town) and `us-east-1`. Staging holds only test data, so the legal question of where *real* South African data may live (POPIA) can wait for counsel before **production**. `af-south-1` must be switched on by hand and costs more. |
| **Where your sign-in directory lives** (IAM Identity Center "home region") | The **same region** you picked | It is hard to move later. |
| **Who approves production deploys** | A **second person** | The deploy workflow waits for a reviewer. If you are the only person, you approve your own deploys, which defeats the point; a second trusted person (even part-time) is much better. |
| **Domain** | `myforgepay.com`, with DNS moved to AWS Route 53 in phase 4 | The deploy needs a real name and a certificate. |

---

## Phase 1: Secure the account you have (an hour or two)

Use the **AWS Management Console** (the website, `console.aws.amazon.com`).

### 1.1 Sign in as root and protect it

1. Sign in with the email and password you created the account with. (Choose "Root user" on the sign-in page.)
2. Click your account name at the top right > **Security credentials**.
3. Under **Multi-factor authentication (MFA)** choose **Assign MFA device**. The simplest is an **authenticator app** on your phone (Google Authenticator, Authy, 1Password, Microsoft Authenticator). A hardware key (a YubiKey) is better if you have one.
   Follow the prompts; AWS asks for two codes in a row to prove it works.
4. **Save the recovery path:** write down, on paper, which phone or device holds the MFA, and keep a second copy of the authenticator's backup/recovery option if the app offers one. Losing both the password and the MFA device means a slow recovery process with AWS support.
5. On the same **Security credentials** page, scroll to **Access keys**. It must say you have **none**. If a root access key exists, **delete it** (root keys are the most dangerous secret an account can have).

**Check:** the page now shows your MFA device as assigned, and "Access keys (0)".

### 1.2 A budget alert, so a mistake cannot become a surprise bill

1. In the search bar at the top type **Billing and Cost Management** and open it.
2. In the left menu choose **Budgets** > **Create budget**.
3. Pick **Use a template (simplified)** > **Monthly cost budget**. Name it `monthly-limit`. Set an amount you are comfortable with for staging; **US$200** is a sensible starting alert for now. Put your email in the recipients box > **Create budget**.
4. Create a second budget the same way at a higher figure (for example US$400) so you get a louder second warning.

A budget **warns**; it does not stop spending. You are still the safety net: tear staging down when not in use.

**Check:** the Budgets page lists both, and AWS has emailed you a confirmation.

### 1.3 Set the account's contacts

Account name (top right) > **Account** > under **Alternate contacts** fill in **Billing**, **Operations** and **Security** with real, monitored addresses (a shared address such as `aws@yourcompany` is better than one person's inbox). AWS sends urgent security notices here.

### 1.4 Create your everyday administrator (so you can stop using root)

1. Top-right region menu: **choose the region you decided on above** (for example Europe (London) `eu-west-2`).
2. Search **IAM Identity Center** and open it > **Enable**. If it offers "Enable with AWS Organizations", accept: this also creates an AWS Organization, which you need in phase 2.
3. In IAM Identity Center: **Users** > **Add user**. Use your real name and a work email (a different email from the root one is fine, and better). AWS emails you an invitation to set a password: accept it.
4. **Permission sets** > **Create permission set** > **Predefined** > **AdministratorAccess**. (This is broad on purpose for now; we tighten it later.)
5. **AWS accounts** > select your account > **Assign users or groups** > your user > the permission set you just made > **Submit**.
6. In IAM Identity Center > **Settings** > **Authentication** > **Configure** under multi-factor: turn MFA on for users, and register an authenticator for your new user the first time you sign in.
7. Note the **AWS access portal URL** on the Identity Center dashboard (it looks like `https://d-xxxxxxxxxx.awsapps.com/start`). **From now on you sign in through that URL, not as root.**

**Check:** open the access portal URL in a private window, sign in as your new user (with MFA), and you can click your account and "Management console". Sign out of root.

### 1.4a Test that you are not locked out

Before moving on, confirm both: you can sign in through the portal, **and** you know where the root MFA device is. Do not skip this: it is the moment to find a problem, not later.

### 1.5 An audit trail

1. Search **CloudTrail** > **Trails** > **Create trail**. Name `account-trail`; apply to **all regions**; create a **new S3 bucket**; leave encryption on; **Create trail**.

This records who did what in your account. It is cheap and it is the first thing anyone investigating a problem will ask for.

**Check:** the trail shows "Logging".

---

## When phase 1 is done, tell me

Reply with (no secrets):
- the **region** you chose,
- whether each **check** above passed (just "1.1 yes, 1.2 yes ...", and describe anything that looked different),
- whether you will have a **second person** to approve production deploys,
- where **myforgepay.com** is registered (the company that sells you the domain) so I can write phase 4 for that exact place.

If you want me to look at the account for you, run `/mcp` in Claude Code and sign the AWS connection in again. I would only read (list settings, check MFA and trails); I would change nothing without asking.

---

## Phases 2 to 8, in outline (I will expand each when you reach it)

**Phase 2: a separate staging account.** In **AWS Organizations** > **Add an AWS account** > **Create an AWS account**: name `forgepay-staging`, an email address nobody else uses (an alias such as `aws+staging@yourcompany`
works with most mail providers). Then in IAM Identity Center assign your user to the new account. Production gets its own account later.

**Phase 3: tools.** Install the AWS CLI v2, Terraform (1.6 or newer), kubectl and Helm. Then `aws configure sso` (it asks for the access portal URL and a profile name; use `forgepay-staging`), `aws sso login --profile forgepay-staging`,
and prove it with `aws sts get-caller-identity --profile forgepay-staging`. The answer must show the **staging** account number.

**Phase 4: domain and certificate.** In Route 53 create a hosted zone for `myforgepay.com`, copy its four name servers into your registrar, wait for DNS to switch. Then in **ACM**, **in your cluster's region** (not `us-east-1`; that is only for the website's CloudFront), request a certificate for
`console.staging.myforgepay.com` (and the other staging names) with **DNS validation**, and wait for "Issued". Note its ARN: it becomes the `ACM_CERT_ARN` variable.

**Phase 5: plan (a dry run).** `forgepay/infra/staging/aws-prerequisites.sh <region>` creates the place Terraform keeps its notes (an S3 bucket and a lock table), a key, container repositories and two roles. Then
`forgepay/infra/staging/deploy-staging.sh <region> --dry-run` prints what it *would* build. **We read that output together before anything is built.** Note: bucket names are unique across all of AWS, so if the script says a name is taken, stop and tell me (the fix is a small change to the name).

**Phase 6: build staging.** It builds a network, a Kubernetes cluster (EKS), a database, Redis and keys. **Cost warning:** this is the expensive step. As a very rough guide from public list prices (I have not priced the exact plan, and prices vary by region): the Kubernetes control plane alone is about
US$73 a month, each NAT gateway about US$32 a month plus data, a load balancer about US$16 a month, plus the database and Redis. **Expect a few hundred US dollars a month if staging is left running all the time.** Read the cost line of the plan, and tear it down (`teardown-staging.sh`) when you are not using it.

**Phase 7: let GitHub deploy safely.** Create the OIDC provider and the deploy role (the exact trust policy is in `docs/launch/14-deploying-services.md`), the EKS access entry, the GitHub **`production`** environment with required reviewers, and the variables. No access keys anywhere.

**Phase 8: the first dry-run deploy.** Run *Deploy ForgePay service* with `dry_run` ticked. It proves sign-in, cluster access and the chart without changing anything.

Before phase 8 there is one repository step I will help with: merging this work to `main` so the first images signed by `main` exist (production deploys only accept those).

## If something goes wrong

- **Locked out / lost MFA:** do not guess at recovery; use the AWS sign-in page's "Troubleshoot MFA" option and AWS Support.
- **A bill you did not expect:** Billing > **Bills** shows cost by service; the biggest line is usually a forgotten NAT gateway, load balancer or cluster. Tell me which and we will find what is running.
- **You think a secret leaked** (pasted somewhere, committed): tell me *that it happened and where*, never the secret itself. We rotate it (create a new one, retire the old) before doing anything else.
