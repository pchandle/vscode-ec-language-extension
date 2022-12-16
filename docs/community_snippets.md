# VSCode Snippets for Emergent Coding
## What are snippets
Code snippets are templates that make it easier to enter repeating code patterns, such as loops or conditional-statements. The list of snippets below is not integrated into the extension. However, instead, users can add them to their own, custom snippets file. Check out the [VSCode documentation on snippets](https://code.visualstudio.com/docs/editor/userdefinedsnippets). It provides an overview and instructions on how to author snippets. It's really simple - just a little bit of JSON.

To contribute, check out our [guide here](https://github.com/aptissio/vscode-ec-language-extension/blob/main/docs/community_snippets.md#contributing).

## Table of Contents

## Contributing
To optimize snippet usability and discoverability for end users we will only ship snippets in the extension which we believe meet the following requirements:

- Must be broadly applicable to most Emergent Coding extension users
- Must be substantially different from existing snippets or intellisense
- Must not violate any intellectual property rights
If your snippet does not meet these requirements but would still be useful to customers we will include it in our list of [Community Snippets](https://github.com/aptissio/vscode-ec-language-extension/blob/main/docs/community_snippets.md). Additionally, snippet creators can publish snippet libraries as standalone extensions in the [VSCode Marketplace](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

If you'd like a snippet to be considered for addition to the list, [open a pull request](https://opensource.guide/how-to-contribute/#opening-a-pull-request) with the following changes:
### Table of contents
You need to add an item to the table of contents. The addition should follow the alpha ordering of the list. The ToC item template looks like this:
```
| [Name of snippet](link to header of your snippet) | _some short description_ |
```
An example looks like this (NOTE: all lowercase link):
```
| [PSCustomObject](#pscustomobject) |  _A simple PSCustomObject_ |
```
which will show up in the ToC like this:
|Snippet Name|Description|
|--|--|
|PSCustomObject|A simple PSCustomObject|
### Body
You need to also add an item to the body in alpha order. The body item template looks like this:

	### Name of snippet

	Enter your description here. It can be the same as the ToC or a longer version.

	#### Snippet

	```json
	{
		"Put your":"snippet here",
		"indent it":"properly"
	}
	```
An example looks like this:

	### PSCustomObject

	A simple PSCustomObject.

	#### Snippet

	```json
	"PSCustomObject": {
		"prefix": "PSCustomObject",
		"body": [
			"[PSCustomObject]@{",
			"\t${1:Name} = ${2:Value}",
			"}"
		],
		"description": "Creates a PSCustomObject"
	}
	```
which will show up in the body like this:

### PSCustomObject
A simple PSCustomObject.

#### Snippet
	"PSCustomObject": {
		"prefix": "PSCustomObject",
		"body": [
			"[PSCustomObject]@{",
			"\t${1:Name} = ${2:Value}",
			"}"
		],
		"description": "Creates a PSCustomObject"
	}