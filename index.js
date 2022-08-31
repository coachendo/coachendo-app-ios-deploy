const { Toolkit } = require("actions-toolkit");
const core = require("@actions/core");
const semver = require("semver");
const fs = require("fs");
const semver2int = require("semver2int");
const replaceAll = require("string.prototype.replaceall");

// Change working directory if user defined PBX_PATH

if (process.env.PBX_PATH) {
  process.env.GITHUB_WORKSPACE = `${process.env.GITHUB_WORKSPACE}/${process.env.PBX_PATH}`;
  process.chdir(process.env.GITHUB_WORKSPACE);
}

const PbxPath = core.getInput("PBX_PATH");

// Run your GitHub Action!
Toolkit.run(async (tools) => {
  const event = tools.context.payload;

  if (!fs.existsSync(PbxPath)) {
    tools.exit.failure("PBX_PATH is invalid, no file found!");
    return;
  }

  console.log("Selecting bump type based on commits message..");

  if (!event.commits) {
    console.log(
      "Couldn't find any commits in this event, incrementing patch version..."
    );
  }

  const tagPrefix = process.env["INPUT_TAG-PREFIX"] || "";
  const messages = event.commits
    ? event.commits.map((commit) => commit.message + "\n" + commit.body)
    : [];

  const commitMessage =
    process.env["INPUT_COMMIT-MESSAGE"] ||
    "iOS ci: version bump to {{version}}";
  console.log("commit messages:", messages);
  const commitMessageRegex = new RegExp(
    commitMessage.replace(/{{version}}/g, `${tagPrefix}\\d+\\.\\d+\\.\\d+`),
    "ig"
  );
  const isVersionBump =
    messages.find((message) => commitMessageRegex.test(message)) !== undefined;

  if (isVersionBump) {
    tools.exit.success("No action necessary because we found a previous bump!");
    return;
  }

  // input wordings for MAJOR, MINOR, PATCH, PRE-RELEASE
  const majorWords = process.env["INPUT_MAJOR-WORDING"].split(",");
  const minorWords = process.env["INPUT_MINOR-WORDING"].split(",");
  const patchWords = process.env["INPUT_PATCH-WORDING"]
    ? process.env["INPUT_PATCH-WORDING"].split(",")
    : null;
  const preReleaseWords = process.env["INPUT_RC-WORDING"].split(",");

  console.log("config words:", {
    majorWords,
    minorWords,
    patchWords,
    preReleaseWords,
  });

  // get default version bump
  let version = process.env.INPUT_DEFAULT;
  let foundWord = null;
  // get the pre-release prefix specified in action
  let preid = process.env.INPUT_PREID;

  // case: if wording for MAJOR found
  if (
    messages.some(
      (message) =>
        /^([a-zA-Z]+)(\(.+\))?(\!)\:/.test(message) ||
        majorWords.some((word) => message.includes(word))
    )
  ) {
    version = "major";
  }
  // case: if wording for MINOR found
  else if (
    messages.some((message) =>
      minorWords.some((word) => message.includes(word))
    )
  ) {
    version = "minor";
  }
  // case: if wording for PATCH found
  else if (
    patchWords &&
    messages.some((message) =>
      patchWords.some((word) => message.includes(word))
    )
  ) {
    version = "patch";
  }
  // case: if wording for PRE-RELEASE found
  else if (
    messages.some((message) =>
      preReleaseWords.some((word) => {
        if (message.includes(word)) {
          foundWord = word;
          return true;
        } else {
          return false;
        }
      })
    )
  ) {
    version = "prerelease";
  }

  console.log("version action after final decision:", version);

  // case: if nothing of the above matches
  if (version === null) {
    tools.exit.success("No version keywords found, skipping bump.");
    return;
  }

  // Incrementing the version by version tag
  // versionCode — A positive integer [...] -> https://developer.android.com/studio/publish/versioning
  const versionCodeRegexPattern = /CURRENT_PROJECT_VERSION = ([0-9]+)/g;
  const versionMarketingRegexPattern =
    /MARKETING_VERSION = ([0-9]+.[0-9].[0-9])/g;

  let fileContent = fs.readFileSync(PbxPath);
  console.log("file content: ", versionCodeRegexPattern.exec(fileContent)[0]);
  console.log(
    "file content: ",
    versionMarketingRegexPattern.exec(fileContent)[0]
  );

  // let currentVersionName = semver.clean(versionCodeRegexPattern.exec(fileContent.toString())[1]);
  let currentVersionName = versionCodeRegexPattern
    .exec(fileContent)[0]
    .toString()
    .replace("CURRENT_PROJECT_VERSION = ", "");
  let currentVersionNameMarketing = versionMarketingRegexPattern
    .exec(fileContent)[0]
    .toString()
    .replace("MARKETING_VERSION = ", "");

  console.log(`Current version: ${currentVersionName}`);
  console.log(`Current MARKETING version: ${currentVersionNameMarketing}`);

  console.log("THE VERSION: ", version);
  // let newVersionName = semver.inc(currentVersionName, "minor");
  // let newVersionName =   currentVersionName + 1
  let newMarketingVersionName = semver.inc(
    currentVersionNameMarketing,
    version
  );
  console.log(
    "SEMVER MARKETING V: ",
    semver.inc(currentVersionNameMarketing, version)
  );
  let newVersionName = semver2int(newMarketingVersionName);

  // console.log('NEW VERSION NAME SEMVER: ', semver.inc(currentVersionName, "minor"))
  // console.log(`New version: ${newVersionName}`);

  // console.log('NEW VERSION NAME SEMVER: ', semver.inc(currentVersionName, "minor"))
  console.log(`New version: ${newVersionName}`);
  console.log(`New Marketing version: ${newMarketingVersionName}`);

  let newFileContent = replaceAll(
    fileContent.toString(),
    `CURRENT_PROJECT_VERSION = ${currentVersionName}`,
    `CURRENT_PROJECT_VERSION = ${newVersionName}`
  );
  newFileContent = replaceAll(
    newFileContent.toString(),
    `MARKETING_VERSION = ${currentVersionNameMarketing}`,
    `MARKETING_VERSION = ${newMarketingVersionName}`
  );
  let newVersion;
  console.log("NEW VERSIONNNN DONE");

  // case: if user sets push to false, to skip pushing new tag/package.json
  const push = process.env["INPUT_PUSH"];
  if (push === "false" || push === false) {
    tools.exit.success(
      "User requested to skip pushing new tag and package.json. Finished."
    );
    return;
  }

  // GIT logic
  try {
    // set git user
    await tools.exec("git", [
      "config",
      "user.name",
      `"${process.env.GITHUB_USER || "Autobump iOS version"}"`,
    ]);
    await tools.exec("git", [
      "config",
      "user.email",
      `"${
        process.env.GITHUB_EMAIL ||
        "gh-action-bump--ios-version@users.noreply.github.com"
      }"`,
    ]);

    let currentBranch = /refs\/[a-zA-Z]+\/(.*)/.exec(process.env.GITHUB_REF)[1];
    let isPullRequest = false;
    console.log("GITHUB HEAD REF: ", process.env.GITHUB_HEAD_REF);
    if (process.env.GITHUB_HEAD_REF) {
      // Comes from a pull request
      currentBranch = process.env.GITHUB_HEAD_REF;
      isPullRequest = true;
    }
    if (process.env["INPUT_TARGET-BRANCH"]) {
      // We want to override the branch that we are pulling / pushing to
      currentBranch = process.env["INPUT_TARGET-BRANCH"];
    }
    // do it in the current checked out github branch (DETACHED HEAD)
    console.log("currentBranch:", currentBranch);

    // Writing the new version to the gradle file
    fs.writeFileSync(PbxPath, newFileContent);

    console.log('TAGGG: ', tagPrefix)
    // Committing
    newVersion = `${tagPrefix}${newMarketingVersionName}`;
    await tools.exec("git", [
      "commit",
      "-a",
      "-m",
      commitMessage.replace(/{{version}}/g, newVersion),
    ]);

    // now go to the actual branch to perform the same versioning
    console.log("isPullRequest: ", isPullRequest);
    // if (isPullRequest) {
    //   // First fetch to get updated local version of branch
    //   await tools.exec("git", ["fetch"]);
    // }
    await tools.exec("git", ["fetch"]);
    await tools.exec("git", ["checkout", currentBranch]);
    fs.writeFileSync(PbxPath, newFileContent);
    newVersion = `${tagPrefix}${newMarketingVersionName}`;
    console.log(`::set-output name=newTag::${newVersion}`);
    try {
      // to support "actions/checkout@v1"
      await tools.exec("git", [
        "commit",
        "-a",
        "-m",
        commitMessage.replace(/{{version}}/g, newVersion),
      ]);
    } catch (e) {
      console.warn(
        'git commit failed because you are using "actions/checkout@v2"; ' +
          'but that doesnt matter because you dont need that git commit, thats only for "actions/checkout@v1"'
      );
    }

    const remoteRepo = `https://${process.env.GITHUB_ACTOR}:${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git`;
    if (process.env["INPUT_SKIP-TAG"] !== "true") {
      await tools.exec("git", ["tag", newVersion]);
      await tools.exec("git", ["push", remoteRepo, "--follow-tags"]);
      await tools.exec("git", ["push", remoteRepo, "--tags"]);
    } else {
      await tools.exec("git", ["push", remoteRepo]);
    }
  } catch (e) {
    tools.log.fatal(e);
    tools.exit.failure("Failed to bump version");
  }
  tools.exit.success("iOS version bumped!");
});
