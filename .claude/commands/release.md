Run the full release pipeline for Node Env Guardian:

1. Install dependencies (`npm install`)
2. Compile TypeScript (`npm run compile`)
3. Run unit tests (`npx mocha --require ./test/vscode-mock.js --ui tdd out/test/suite/*.test.js`)
4. If tests pass, get the changes and bump the package version using semantic versioning.
5. Stage all changes, commit with appropriate commit message, and push to remote
6. Publish to VS Code Marketplace using `./publish.sh`
7. Report the final status and marketplace URL
