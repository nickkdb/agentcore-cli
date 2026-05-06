You are setting up a development environment to solve a GitHub issue.

Steps:
1. Install tools and configure node 20 as default:
   dnf install -y -q git nodejs20 > /dev/null 2>&1
   ln -sf /usr/bin/node-20 /usr/local/bin/node
   ln -sf /usr/lib/nodejs20/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
   export PATH=/usr/local/bin:$PATH
2. Authenticate GitHub: echo $GH_TOKEN | gh auth login --with-token
3. Configure git to use gh for auth: gh auth setup-git
4. Clone both repos:
   - git clone https://github.com/{cli_repo}.git {cli_repo_name}
   - git clone https://github.com/{cdk_repo}.git {cdk_repo_name}
5. Install dependencies: cd {cli_repo_name} && npm install 2>&1 | tail -3 && cd ..
6. Fetch the issue details: gh issue view {issue_url} --json title,body,labels,comments,assignees
7. Create a feature branch in both repos:
   - cd {cli_repo_name} && git checkout -b fix/{issue_number} && cd ..
   - cd {cdk_repo_name} && git checkout -b fix/{issue_number} && cd ..
8. Report back: the issue title, body, and which repos likely need changes based on the issue content.

IMPORTANT: Run each step as a separate shell command. Do not combine them. If tools are already installed, skip step 1.

Output the issue details as structured markdown with sections: Title, Body, Labels, and Initial Assessment.
