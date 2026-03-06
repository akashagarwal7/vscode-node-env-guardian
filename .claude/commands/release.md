Run the full release pipeline for Node Env Guardian:

1. Install dependencies (`npm install`)
2. Compile TypeScript (`npm run compile`)
3. Run unit tests (`npx mocha --require ./test/vscode-mock.js --ui tdd out/test/suite/*.test.js`)
4. If tests pass, stage all changes, commit with message "Release <version from package.json>", and push to remote
5. Publish to VS Code Marketplace using `./publish.sh`
6. Report the final status and marketplace URL