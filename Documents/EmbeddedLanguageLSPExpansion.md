# Expanding LSP to Support Embedded Languages

This document details a solution to enable embedded languages to provide fully reusable, reliable and high quality tooling experiences in the form of language servers (LS) through expansion of the [language server protocol (LSP)](https://microsoft.github.io/language-server-protocol/specification).

## Table of Contents

- [Problem Background](#problemBackground)
- [Solutions](#solutions)
    - [Historical solutions](#historicalSolutions)
    - [Proposed solution](#proposedSolution)
- [Examples and scenarios](#scenarios)
    - [Document State](#documentStateExample)
    - [Language Feature](#completionExample)
    - [Diagnostics](#diagnosticsExample)
    - [External Interactions](#externalInteractionsExamples)
- [LSP Spec Expansion](#specExpansion)
- [Open Questions](#openQuestions)

# <a href="#problemBackground" name="problemBackground">Problem Background</a>

An embedded language is a language that hosts other languages inside of it. Today there are an increasing number of embedded languages, a few examples to bring to light are: HTML (CSS / JavaScript), PHP (HTML), Visual Basic (XML), React/JSX (HTML) and Razor (HTML / C#). As tooling ecosystems grow towards supporting the latest LSP, embedded language tooling has been left to fend for itself. In its current form, embedded language tooling often [re-hosts innerworkings](#rehostingApproach) of their embedded languages or rely on [platform dependent implementations](#delegationApproach) to provide quality embedded langauge editing experiences for developers. As LSP currently exists it defines contracts that are appealing to embedded language tooling implementations but lacks the tools or guidance to hook experiences together.

VSCode has been the front runner in giving embedded languages a model to follow; however, even their [guidance](https://code.visualstudio.com/api/language-extensions/embedded-languages) results in a platform dependent model that puts a significant burden on embedded language client implementations to build out complex document state, synchronization & request forwarding mechanisms.

To summarize, the current LSP spec & guidance result in embedded languages needing to build out highly complex, platform dependent infrastructure to enable any cross-platform, highly functional experiences.



# <a href="#solutions" name="solutions">Solutions</a>

## <a href="#historicalSolutions" name="historicalSolutions">Historical Solutions</a>

*Note: This section is not necessary to understand the embedded language LSP spec expansion, it's just historical information to better understand motivations for the [proposed solution below](#proposedSolution).*

There are two pre-existing approaches to building out an embedded language LSP solution. One which re-hosts all sub-languages in a singular language server and another which splits its logic into two components, a re-usable language server and a platform specific component that understands how to intercept and delegate requests for common features, i.e. completion, hover etc.

### <a href="#rehostingApproach" name="rehostingApproach">The Re-Hosting Approach</a>

Re-hosting was the first approach at having an embedded language LSP compliant experience. In its infancy embedded languages would re-host all sub-languages underneath them in order to provide tooling experiences. For instance, in PHP it'd re-host HTML, CSS and JavaScript language services (or even sometimes language servers) to enable language specific experiences. This enabled PHP to provide HTML completions when a user would type `<` inside of a document.

So lets analyze what handling a feature in this model might look like for an index.php document with content (pipe denotes the cursor):
```PHP
<div>
    <?php echo '<strong>Hello World!</strong>'; ?>
    |
</div>
```

1. User types `<` and the client (i.e. VSCode) sends a `textDocument/completion` request to PHP Language Server (PHPLS) at line 2 (0 indexed), character 5 (`<` now exists in the buffer). We'll represent this with (2, 5)
1. In PHPLS' completion handler it detects which language is applicable at (2, 5). It determines that two languages should return completions, HTML and PHP. HTML for the various `p`, `strong` etc. elements and PHP for `?php`.
1. PHPLS updates its virtual document for the current HTML content that corresponds to index.php, lets call this index.php.html:
    ```HTML
    <div>
        <
    </div>
    ```
    NOTE: The `<?php ... >` piece is ommitted because technically that line isn't relevant to HTML.
1. PHPLS finds out where (2, 5) exists in index.php.html. Results in (1, 5)
1. PHPLS hands over its index.php.html document content to an HTML language service and asks it for completions at (1, 5).
1. The HTML language service responds with [`p`, `strong`, ...]
1. PHPLS then aggregates HTML's completions with its own and returns an entire list of completions [`p`, `strong`, `?php`, ...]
1. Client presents the combined completion list.

Throughout the above flow there are several concerns that were glazed over which make the re-hosting approach troublesome. Here are some of the drawbacks of re-hosting:
1. All sub-language interactions are invisible to client extensions. For instance, what if there was an [emmet extension](https://emmet.io/) on the client and the user was expecting to be able to use it?
1. Settings don't translate. Embedded languages have their own set of settings on how things format, which things get offered in completion etc. Re-hosting can't utilize pre-existing settings so it requires users to re-implement every setting.
1. Language detection results in highly coupled flows. In the above example, what would have happened if the user was in a `<script>` block? The host language needs to understand every sub-language underneath it OR that sub-langauge needs to also re-host all of its inner workings so the correct requests can make it to corresponding language services.
1. Dependent on sub-language architecture. If the PHP language server was written in PHP but the HTML language service was written in NodeJS, how do they communicate? This problem gets exacerbated when more sub-langauges come into the mix and then they all need to work in a cross-platform manner.
1. Updates become difficult and introduce fragility. What happens when a new version of HTML or CSS or JavaScript comes out? You now need to update the underlying language services and ensure all interactions with them work as they did in the past.

|                             | Supported                                          |
| --------------------------- | -------------------------------------------------- |
| Platform Agnostic           | :heavy_check_mark: :grey_question:                 |
| Flexible                    | :x:                                                |
| Maintainable                | :x: :grey_question:                                |
| Future proof                | :x:                                                |
| Feature Rich                | :heavy_check_mark: :grey_question:                 |
| Extension Friendly          | :x:                                                |
| External Server Interaction | :x:                                                |

The :grey_question: indicates that there's some uncertainty based on the various embedded language requirements. Aka, not all embedded language services may be cross-plat or be feature rich and although highly unlikely, some hosted languages may actually be maintainable if they never need or want to update.

### <a href="#delegationApproach" name="delegationApproach">The Delegation Approach</a>

A delegation / request forwarding approach quickly followed the re-hosting model in an effort to solve some of the support matrix flaws that re-hosting introduced. This approach LSP compliant approach consists of two pieces:

1. A delegation component which is typically in-proc to the corresponding platform to enable request forwarding, language synchronization and aggregation of sub-language results.
1. A language server with knowledge of its immediate sub-languages. For instance a PHP language server in this model would know which portions of its document were HTML portions but not the CSS/JS portions.

Both of these components work together to orchestrate the end-to-end experience users experience when working in the embedded language. Lets analyze what handling a feature in this model might look like for an index.php document with content (pipe denotes the cursor):
```PHP
<div>
    <?php echo '<strong>Hello World!</strong>'; ?>
    |
</div>
```

1. User types `<` and the client (i.e. VSCode) dispatches two textDocument/completion requests at line 2 (0 indexed), character 5 (`<` now exists in the buffer). We'll represent this with (2, 5)
    1. One to the PHP Language Server (PHPLS)
    2. A second to the delegation component. We'll denote this as the PHP Delegation Component (PHPDC).
1. In the PHPLS' completion handler it determines that it should provide a PHP domain specific completion: `?php`. It returns it.
1. In the PHPDC completion handler it authors a custom LSP request to ask PHPLS what immediate sub-language exists at (2, 5) and at what location. It responds with "HTML" at (1, 5)
1. PHPDC ensures that an HTML document exists on the client exists to represent the HTML interactions for index.php. PHPDC assigns it an addressable uri index.php.html
1. PHPDC uses custom LSP requests to acquire the virtual HTML content from PHPLS for index.php. PHPLS returns:
    ```HTML
    <div>
        <
    </div>
    ```
    NOTE: The `<?php ... >` piece is ommitted because technically that line isn't relevant to HTML.

    1. PHPDC updates the index.php.html with the received content.
    1. The client sees a document content update to index.php.html and notifies all HTML language servers of the updated content
1. PHPDC constructs a new textDocument/completion request pointing to index.php.html at (1, 5) and asks the client to query all associated language servers and for the client to aggregate the results. Active HTML language servers respond with [`p`, `strong`, ...]
1. PHPDC receives the completion result and returns it as its own
1. Client receives [ `?php` ] from PHPLS and [`p`, `strong`, ...] from PHPDC, combines the two completion lists and then presents the result.

> **_NOTE:_** Fast forward past the delegation approaches initial unvieling there have been variants that help further reduce the complexity of various interactions. Those variants do things like provide a single delegation language server that's platform dependent and tries to play the ultimate role of delegator (even for the top-level language, in this case PHP). These routes have solidified the delegation approach as an extremely strong alternative to the re-hosting approach but unfortunately still have some of the drawbacks listed below.

Throughout the above flow there are several concerns that were glazed over which make the delegation approach difficult. Here are some of the drawbacks of delegation:
1. Document content updates leave opportunity for de-synchronization. Since the document source of truth is coming from PHPLS yet embedded language document content is updated via requests or notifications there is not a single source of truth to manage document updates in a way that both language servers can play nicely. Given that we only have one buffer representing the embedded language this type of synchronization becomes paramount and to combat this the delegation approach will ocasionally throw away requests if document versions have diverged significantly to protect the user.
1. PHPDC requires that the platform it's built on has two capabilities:
    1. Ability to create readonly, hidden documents
    1. Programatic LSP invocation. Aka, the ability to query for "completions" or "hover" etc. for a document.
1. PHPDC has to run in-proc to delegate requests binding it to the corresponding clients architecture (i.e. PHPDC would be C# for Visual Studio or JavaScript in VSCode)
1. PHPDC ultimately is meant to be unintelligent plumbing for the platform but is innately complex.

|                             | Supported                                          |
| --------------------------- | -------------------------------------------------- |
| Platform Agnostic           | :x: :grey_question:                                |
| Flexible                    | :x:                                                |
| Maintainable                | :heavy_check_mark:                                 |
| Future proof                | :heavy_check_mark:                                 |
| Feature Rich                | :heavy_check_mark: :grey_question:                 |
| Extension Friendly          | :heavy_check_mark:                                 |
| External Server Interaction | :x:                                                |

The :grey_question: indicates that there's some wiggle room. PHPLS is platform agnostic but PHPDC is not and due to the complexity of PHPDC the feature richness does have some restrictions due to the need to throw out requests occasionally.


## <a href="#proposedSolution" name="proposedSolution">Proposed Solution</a>

In all embedded language solutions there has always been the idea of querying sub-language tooling capabilities by creating hidden documents that contain language relevant data; we call these hidden documents "virtual text documents". For instance, lets take the following HTML scenario:

```HTML
<html>
    <head>
        <script type="text/javascript" src="site.js"></script>
        <script>
            console.log('The current site name is: ' + siteName);
        </script>
    </head>
</html>
```

This document will typically result in several virtual text documents to represent the JavaScript, CSS and any other sub-language that may exist in it. In this example you could imagine the JavaScript virtual text document could look something like:

```typescript
// From site.js
var siteName = "My SiteName"

// From host file
    console.log('The current site name is: ' + siteName);
```

This way when you're typing in the second `<script>` block you get all the JavaScript completion items from site.js (e.g. `siteName`) even though they aren't directly present in the HTML file.

As you can imagine these virtual text documents drive nearly every embedded language interaction but aren't well defined in the LSP landscape. Therefore, the first step to building a end-to-end solution for embedded languages in LSP is to define what it means to work with a virtual text document. These are the three focal points when doing anything with virtual text documents:
1. Managing virtual text document state
1. Querying virtual text document data
1. External virtual text document interactions

### Manging Virtual Text Document State

Virtual document state (i.e. what content should the JavaScript hidden document have in an HTML scenario) is managed via `textDocument/open`, `textDocument/close` and `workspace/applyEdit` requests from server -> client. Ultimately it enables a server to open, edit or close a virtual text document when it sees fit.

- [Example](#documentStateExample)
- [Spec](#spec_VirtualTextDocumentStateManagement)

### Querying Virtual Text Document Data

Once virtual text documents are available the next logical step is to ask those virtual text documents for information. For instance, when a user hovers over a portion of an HTML document it's the job of the "host" language, i.e. HTML, to potentially delegate/query that hover request to the appropriate virtual text document (JS, CSS etc.). Virtual text document data can be queried via requests from the server to the client for commonly known LSP features like `textDocument/completion`, `textDocument/diagnostic` etc. This method effectively allows a server to treat a client as another language server where the responsibility of the client is to delegate and translate the request to all applicable language servers in their version of LSP and then aggregate the responses together.

- [Completion Example](#completionExample)
- [Diagnostics Example](#diagnosticsExample)
- [Spec](#spec_QueryingData)

### External Virtual Text Document Interactions

When language servers get in the business of creating virtual text documents they then have to worry about what it means for other language servers to take those documents into consideration when returning results. For instance, what happens if you or someone else tries navigating to or even editing a virtual text document (it's hidden)? What happens if an operation like rename is performed on a non-virtual text document that *should* have host document reactions? Answering these questions results in two to three top level LSP types that can externally interact with virtual text documents: `WorkspaceEdit` and `Location`/`LocationLink`s which are represented in the go-to-X, find all references, rename and workspace edit applications requests.

When a client identifies that a location or workspace edit applies to virtual text documents from an external server (a server that didn't create the virtual text document) it's the clients' responsibility to send translation requests to the language server that owns the virtual text documents. This translation request gives the language server the opportunity to filter, remap or add edits/locations prior to applying the final result.

- [Examples](#externalInteractionsExamples)
- [Spec](#spec_ExternalVirtualTextDocumentInteractions)

### Conclusion

By standardizing what it means for embedded languages to create virtual text documents, query their data and control external interactions with them, embedded langauges become a first-class citizen in LSP enabling them to provide feature rich, reliable and reusable tooling experiences.

|                             | Supported          |
| --------------------------- | ------------------ |
| Platform Agnostic           | :heavy_check_mark: |
| Flexible                    | :heavy_check_mark: |
| Maintainable                | :heavy_check_mark: |
| Future proof                | :heavy_check_mark: |
| Feature Rich                | :heavy_check_mark: |
| Extension Friendly          | :heavy_check_mark: |
| External Server Interaction | :heavy_check_mark: |

# <a href="#scenarios" name="scenarios">Examples and Scenarios</a>

## <a href="#documentStateExample" name="documentStateExample" class="anchor">Document State Example</a>

When the host language (i.e. HTML, Razor etc.) changes it can "update" its corresponding embedded language representations via `workspace/applyEdit` requests from server -> client. This path enables all embedded document state management to transfer across platforms, be visible to extensions and most of all be standardized.

- Opening is done via a `textDocument/open` requests. [Spec](#spec_openingVirtualTextDocuments)
- Changing is done via normal workspace edits with document changes. [Spec](#spec_changingVirtualTextDocuments)
- Closing is done via `textDocument/close` requests. [Spec](#spec_closingVirtualTextDocuments)

Here's an example in Razor (C# / HTML are sub-languages) where a user opens a file, types an `@` and then closes the file (`@` transitions into C#). It represents what happens for the C# embedded language (excludes the HTML  embedded language for simplicity).

![image](https://user-images.githubusercontent.com/2008729/154007006-1ed9ed83-9bdb-4060-b095-af05c9e358d6.png)

**Important:** For all the details on virtual document state management check out the [full spec](#spec_VirtualTextDocumentStateManagement) below. 

## <a href="#completionExample" name="completionExample" class="anchor">Language Feature Example (Completion)</a>

A host language server can present embedded language features by delegating to well-defined contracts on the client to forward / delegate requests to embedded language documents. This way the host language server can present the responses as a combined result from the originating language server. This path enables language servers to support embedded language interactions in a cross-plat, extension friendly way while simultaneously eliminating synchronization complexity/limitations.

Here's an example of a user in an open Razor document typing `@` to get C# compeltions (`@` transitions into C#):

![image](https://user-images.githubusercontent.com/2008729/111101913-1bf1dc00-8508-11eb-8350-ca3c4a03ba42.png)

*Note: the embedded-csharp:/ scheme was left out for simplicity*

**Important:** For all the details on virtual document language features check out the [full spec](#spec_LanguageFeatures) below. 

## <a href="#diagnosticsExample" name="diagnosticsExample" class="anchor">Diagnostics Example</a>

A host language server can provide embedded language diagnostics by delegating to the document diagnostic endpoint on the client to ask embedded language servers for sets of diagnostics.

Here's an example of a user in an open Razor document having just typed the `@` character (invalid on its own in Razor). Typically this produces two diagnostisc, one from Razor saying you need content after the `@` and one from C# about missing C# content; however, in the example below only one is returned because Razor filters out the C# diagnostic in favor of the Razor one:

![image](https://user-images.githubusercontent.com/2008729/111101991-46dc3000-8508-11eb-8cbc-9e7d9c7bbc5b.png)

*Note: the embedded-csharp:/ scheme was left out for simplicity*

**Important:** For all the details on virtual document diagnostics check out the [full spec](#spec_Diagnostics) below. 

## <a href="#externalInteractionsExamples" name="externalInteractionsExamples" class="anchor">External Interactions Examples</a>

A host language server can serve as a translator for `WorkspaceEdit`s and `Location`/`LocationLink`s that are pointed towards virtual text documents it owns. Common scenarios include:

- User renames a symbol in a non-virtual text document that happens to exist in a virtual text document.
- User finds references on a symbol that also is used in a virtual text document.

In both of the above the host language server typically wants to either remap the result to a location in the host text document, throw it out completely or add additional results.

### <a href="#remappingInteractionExamples" name="remappingInteractionExamples" class="anchor">Remapping Interaction Examples</a>

This section contains examples for when a host language server wants to remap edits or locations that are pointed towards virtual text documents.

In these two examples there are two top-level files:

1. Person.cs which contains a class for a `Person` object in C# syntax:
    ```C#
    public class Person
    {
        public string Name { get; set; }
    }
    ```
1. Users.razor which renders a list of people in Razor syntax:
    ```razor
    @foreach (var person in People)
    {
        <p>Name: @person.Name</p>
    }
    ```

And a C# virtual text document to represent the C# for Users.razor, Users.razor.cs:
```C#
public partial class Users
{
    public void Render(RenderTreeBuilder __builder)
    {
        foreach (var person in People)
        {
            __builder.Add(person.Name)
        }
    }
}
```

#### <a href="#renameInteractionExample" name="renameInteractionExample" class="anchor">Rename Interaction Example</a>

User attempts to rename the `Name` property of `Person` to `FirstName` via `Person.cs`:

![image](https://user-images.githubusercontent.com/2008729/111102065-73904780-8508-11eb-9654-92cfd95889ff.png)


#### <a href="#findReferencesExample" name="findReferencesExample" class="anchor">Find References Interaction Example</a>

User attempts to find references of the `Name` property of `Person` via `Person.cs`:

![image](https://user-images.githubusercontent.com/2008729/111103695-447bd500-850c-11eb-80de-fb27d5b8e21e.png)

*Note: Same flow applies if `LocationLink`s are returned. Instead it uses the `translate/locationLink` endpoint*

### <a href="#additiveInteractionExample" name="additiveInteractionExample" class="anchor">Additive Interaction Example</a>

This section is meant to detail what it takes to perform more complex operations where an edit would be added to a result for an embedded langauge when initiated on a non-virtual text document.

In this examples there are three top-level files:

1. Address.cs which contains a partial class for a `Address` class in C# syntax:
    ```C#
    public partial class Address
    {
        // A [Parameter] makes it so if someone tries to utilize the "Address" object 
        // in HTML they can via <Address StreetName="Broadway" />
        [Parameter] public string StreetName { get; set; }
    }
    ```
1. Address.razor which utilizes the `StreetName` property from the Address.cs file. The Razor syntax always generates its C# classes as partial classes so that code can be written in C# or Razor and utilized in either:
    ```razor
    <p>Street name: @StreetName</p>
    ```
1. Company.razor which uses Address.razor custom component:
    ```razor
    <Address StreetName="Pine Street" />
    ```

And a `__SymbolHelper.cs` C# virtual document that the Razor language server uses to aid in understanding when external symbol interactions occur. It writes down all of its symbols in a mappable way so that when they're changed via a rename, or reference etc. it knows how to map those interactions to other languages like HTML:
```C#
public class __SymbolHelpers
{
    public void __HelperMethod()
    {
        var v1 = typeof(Address); // Maps to Address.razor and usages of <|Address| .../> 
        var v2 = nameof(Address.StreetName); // Maps to <Address |StreetName|="..." />
        var v3 = typeof(Company); // Maps to Company.razor and usages of <|Company| .../>
    }
}
```

And of course there's C# virtual documents to represent Address.razor and Company.razor's C# but their content is not relevant for this example.

User attempts to rename `StreetName` to `Street` via Address.cs with the expectation that it will not only rename the C# representation but also the HTML representation in Company.razor:

![image](https://user-images.githubusercontent.com/2008729/111101771-cd444200-8507-11eb-854b-f1cb71870513.png)

The interesting result of this would modify Company.razor to be:
```razor
<Address Street="Pine Street" />
```
*Note how the HTML attribute `StreetName` changed to `Street` even though the rename was initiated on a C# property*

# <a href="specExpansion" name="specExpansion">Virtual Text Document Support LSP Spec Expansion</a>

## <a href="#spec_VirtualTextDocumentStateManagement" name="spec_VirtualTextDocumentStateManagement" class="anchor">Virtual Text Document State Management</a>

Virtual document state is managed via a combination of `textDocument/open`, `textDocument/close` and `workspace/applyEdit` requests. The `TextDocumentClientCapabilities` define the text document client capabilities and with this spec expansion get expanded to support open/close requests to enable the management of virtual text document state.

_Client Capabilities:_

- Expanded property name: `textDocument`

```typescript
/**
 * Client capabilities specific to virtual text documents
 */
export interface TextDocumentClientCapabilities {
    // ... Existing TextDocumentClientCapabilities ... //

    /**
     * Capabilities specific to the server->client `textDocument/open` request.
     */
    open?: OpenTextDocumentClientCapabilities;

    /**
     * Capabilities specific to the server->client `textDocument/close` request.
     */
    close?: CloseTextDocumentClientCapabilities;
}
```

#### <a href="#spec_openingVirtualTextDocuments" name="spec_openingVirtualTextDocuments">Opening Virtual Text Documents</a>

_Client Capability:_
- property name (optional): `textDocument.open`
- property type: `OpenTextDocumentClientCapabilities`

The `textDocument/open` request is sent from the server to the client. The server can use it to ask the client to open any text document even virtual text documents. Virtual text documents have a `embedded-<language>` URI scheme and their content should be determined by the client; however, typically content is provided via servers implementing the `FileSystem` LSP spec expansion.

Documents opened by `textDocument/open` are not visible to the user, they are only programatically open to issue <a href="#textDocument_didOpen">textDocument/didOpen</a> to all other applicable language servers.

_Request_:
* method: `textDocument/open`
* params: `OpenTextDocumentParams` defined as follows:

```typescript
interface OpenTextDocumentParams {
	/**
	 * The text document to open.
     * 
     * If opening a virtual text document the identifiers URI scheme should be of the form `embedded-<language>`
	 */
	textDocument: TextDocumentIdentifier;
}
```

_Response_:
* result: `OpenTextDocumentResponse` defined as follows:

```typescript
export interface OpenTextDocumentResponse {
	/**
	 * Indicates whether the text document could be opened or not.
	 */
	success: boolean;

	/**
	 * An optional textual description for why the text document could 
     * not be opened. This may be used by the server for diagnostic logging
     * or to utilize another mechanism to show a suitable error to the user.
	 */
	failureReason?: string;
}
```

Opening text documents results in the client issueing a `textDocument/didOpen` to all other applicable language servers.

#### <a href="#spec_changingVirtualTextDocuments" name="spec_changingVirtualTextDocuments">Changing Virtual Text Documents</a>

Virtual documents can be changed by the server that created them via a normal `workspace/applyEdit` request with a corresponding `changes` or `documentChanges`. This results in the client following standard `textDocument/didChange` handling which results in it notifying all appolicable language servers of the change.

**Example:**
```typescript
{
    changes: {
        "file:///some/path/that/doesnotexist.cs": [
            {
                range: {
                    start: {
                        line: 0,
                        character: 1
                    },
                    end: {
                        line: 0,
                        character: 4
                    }
                },
                newText: "Hello"
            }
        ]
    }
}
```

Mutating virtual documents is no different than changing any other file. However, the client typically will not "show" the edited document since it's a virtual language document.

#### <a href="#spec_closingVirtualTextDocuments" name="spec_closingVirtualTextDocuments">Closing a Virtual Text Document</a>

_Client Capability:_
- property name (optional): `textDocument.close`
- property type: `CloseTextDocumentClientCapabilities`

The `textDocument/close` request is sent from the server to the client. The server can use it to ask the client to close any text document, including virtual text documents that are open.

Closing virtual text documents gets translated into <a href="#textDocument_didClose">textDocument/didClose</a>'s to all other applicable language servers.

_Request_:
* method: `textDocument/close`
* params: `CloseTextDocumentParams` defined as follows:

```typescript
interface CloseTextDocumentParams {
	/**
	 * The text document to close.
	 */
	textDocument: TextDocumentIdentifier;
}
```

_Response_:
* result: `CloseTextDocumentResponse` defined as follows:

```typescript
export interface CloseTextDocumentResponse {
	/**
	 * Indicates whether the text document could be closed or not.
	 */
	success: boolean;

	/**
	 * An optional textual description for why the text document could 
     * not be closed. This may be used by the server for diagnostic logging
     * or to utilize another mechanism to show a suitable error to the user.
	 */
	failureReason?: string;
}
```

## <a href="#spec_QueryingData" name="spec_QueryingData" class="anchor">Querying Document Data</a>

Virtual text document data can be queried via requests to the client for commonly known LSP features. If a client supports data querying for a language feature its client capability will have a `queryable` property set to `true`.

For instance, if completion can be re-queried its `CompletionClientCapabilities` will have `queryable` set to `true`. It can then be queried by the server performing a JSONRPC request to `textDocument/completion` with a valid `CompletionParams`object.

```typescript
export interface CompletionClientCapabilities {
    ......

    /**
     * Indicates whether the client supports server -> client requests for 
     * the textDocument/completion request.
     */
    queryable?: boolean
}
```

### <a href="#spec_Diagnostics">Diagnostics</a>

Virtual text document diagnostics have many implications to them. For instance, when languages interchange within the same line or construct do all diagnostics still make sense? Do their ranges map directly 1-to-1 to another document location? In many languages diagnostics don't all translate to a top level document and their ranges position and length get modified. To account for this, virtual document diagnostics rely on LSP's pull based diagnostic approach. Aka the ability for the client to request diagnostics for a document (client -> server) and also the ability for a server to request diagnostics for a virtual text document (sever -> client).

Workspace diagnostics are not supported for virtual documents and therefore shouldn't be displayed by the client or provided from the language server.

| Feature      | Server -> Client Method | Parameters | Response | [VSCode Command](https://code.visualstudio.com/api/references/commands#commands) |
| ------------ | ------------------------- | ---------- | ---------| --------------------|
| Document Diagnostics | textDocument/diagnostics | TBD | TBD | **(New)** vscode.executeDocumentDiagnosticsProvider |

As for `textDocument/publishDiagnostics` notifications from server -> client. These aren't fully supported by virtual text documents. However, a client can choose to throw out `Diagnostic`s that point at a virtual text document or convert a `PublishDiagnosticsParams` into a `Location[]` or `LocationLink[]` and perform a request to the [`translate/locations`](#locationsTranslationRequest) or [`translate/locationLinks`](#locationsTranslationRequest) endpoint to get accurate diagnostics. Keep in mind that the locations/locationLinks endpoints can remove locations so if the list that's passed in does not match the list size that was originally authored the client will have to individually translate each location / location link.

### <a href="#spec_LanguageFeatures">Language Features</a>

Querying language features can be done on any text document (not just virtual text documents). It is the job of the client to handle a server -> client language feature request by:
1. Forwarding the request to all applicable language servers
    - This requires the client to translate the request into a compatible LSP version for each language server. If it cannot it will not query that specific language server.
2. Aggregate the results and return them to the requesting language server

Below is the complete list of all supported queryable (they have a `queryable` client capability) language features with their corresponding parameters and return types.

| Feature      | Server -> Client Method | Parameters | Response (nullable) | [VSCode Command](https://code.visualstudio.com/api/references/commands#commands) |
| ------------ | ------------------------- | ---------- | ---------| --------------------|
| Completion | textDocument/completion | (`CompletionParams`) | `CompletionList` | vscode.executeCompletionItemProvider |
| Completion Resolve | completionItem/resolve | (`DocumentUri`, `CompletionItem`) | `CompletionItem` | **(New)** vscode.executeCompletionResolve |
| Hover | textDocument/hover | (`HoverParams`) | `Hover` | vscode.executeHoverProvider |
| Signature Help | textDocument/signatureHelp | (`SignatureHelpParams`) | `SignatureHelp` | vscode.executeSignatureHelpProvider |
| Goto Declaration | textDocument/declaration | (`DeclarationParams`) | `Location[]` or `LocationLink[]` | vscode.executeDeclarationProvider |
| Goto Definition | textDocument/definition | (`DefinitionParams`) | `Location[]` or `LocationLink[]` | vscode.executeDefinitionProvider |
| Goto Type Definition | textDocument/typeDefinition | (`TypeDefinitionParams`) | `Location[]` or `LocationLink[]` | vscode.executeTypeDefinitionProvider |
| Goto Implementation | textDocument/implementation | (`ImplementationParams`) | `Location[]` or `LocationLink[]` | vscode.executeImplementationProvider |
| Find References | textDocument/references | (`ReferenceParams`) | `LocationLink[]` | vscode.executeReferenceProvider |
| Document Highlight | textDocument/documentHighlight | (`DocumentHighlightParams`) | `DocumentHighlight[]` | vscode.executeDocumentHighlights |
| Document Symbols | textDocument/documentSymbol | (`DocumentSymbolParams`) | `DocumentSymbol[]` | vscode.executeDocumentSymbolProvider !! |
| Code Action | textDocument/codeAction | (`CodeActionParams`) | `Command[] or CodeAction[]` | vscode.executeCodeActionProvider  |
| Code Action Resolve | codeAction/resolve | (`DocumentUri`, `CodeAction`) | `CodeAction` | **(New)** vscode.executeCodeActionResolve |
| Code Lens | codeAction/codeLens | (`CodeLensParams`) | `CodeLens[]` | vscode.executeCodeLensProvider |
| Code Lens Resolve | codeLens/resolve | (`DocumentUri`, `CodeLens`) | `CodeLens` | **(New)** vscode.executeCodeLensResolve |
| Document Link | textDocument/documentLink | (`DocumentLinkParams`) | `DocumentLink[]` | vscode.executeLinkProvider  |
| Document Link Resolve | documentLink/resolve | (`DocumentUri`, `DocumentLink`) | `DocumentLink` | **(New)** vscode.executeLinkResolve |
| Document Color | textDocument/documentColor | (`DocumentColorParams`) | `ColorInformation[]` | vscode.executeDocumentColorProvider |
| Color Presentation | textDocument/colorPresentation | (`ColorPresentationParams`) | `ColorPresentation[]` | vscode.executeColorPresentationProvider |
| Document Formatting | textDocument/formatting | (`DocumentFormattingParams`) | `TextEdit[]` | vscode.executeFormatDocumentProvider |
| Document Range Formatting | textDocument/rangeFormatting | (`DocumentRangeFormattingParams`) | `TextEdit[]` | vscode.executeFormatRangeProvider |
| Document on Type Formatting | textDocument/onTypeFormatting | (`DocumentOnTypeFormattingParams`) | `TextEdit[]` | vscode.executeFormatOnTypeProvider |
| Rename | textDocument/rename | (`RenameParams`) | `WorkspaceEdit` | vscode.executeDocumentRenameProvider |
| Prepare Rename | textDocument/prepareRename | (`PrepareRenameParams`) | `{ range: Range, placeholder: string }` | **(New)** vscode.executePrepareRenameProvider |
| Folding Range | textDocument/foldingRange | (`FoldingRangeParams`) | `FoldingRange[]` | **(New)** vscode.executeFoldingRangeProvider |
| Selection Range | textDocument/foldingRange | (`SelectionRangeParams`) | `SelectionRange[]` | vscode.executeSelectionRangeProvider |
| Prepare Call Hierarchy | textDocument/prepareCallHierarchy | (`CallHierarchyPrepareParams`) | `CallHierarchyItem[]` | vscode.prepareCallHierarchy |
| Hierarchy Incoming Calls | callHierarchy/incomingCalls | (`CallHierarchyIncomingCallsParams`) | `CallHierarchyIncomingCall[]` | vscode.provideIncomingCalls |
| Hierarchy Outgoing Calls | callHierarchy/outgoingCalls | (`CallHierarchyOutgoingCallsParams`) | `CallHierarchyOutgoingCall[]` | vscode.provideOutgoingCalls |
| Semantic Tokens | textDocument/semanticTokens/full | (`SemanticTokensParams`) | `SemanticTokens` | vscode.provideDocumentSemanticTokens |
| Semantic Tokens Range | textDocument/semanticTokens/range | (`SemanticTokensRangeParams`) | `SemanticTokens` | vscode.provideDocumentRangeSemanticTokens |
| Semantic Tokens Legend | **(New)** textDocument/semanticTokens/legend | (`SemanticTokensRangeParams`) | `SemanticTokens` | vscode.provideDocumentSemanticTokensLegend |
| Semantic Tokens Legend Range | **(New)** textDocument/semanticTokens/legend/range | (`DocumentUri`, `Range`) | `SemanticTokens` | vscode.provideDocumentRangeSemanticTokensLegend !! |
| Linked Editing Range | textDocument/linkedEditingRange | (`LinkedEditingRangeParams`) | `LinkedEditingRanges` | **(New)** vscode.provideLinkedEditingRanges |
| Monikers | textDocument/moniker | (`MonikerParams`) | `Moniker[]` | **(New)** vscode.provideMoniker |

## <a href="#spec_ExternalVirtualTextDocumentInteractions" name="spec_ExternalVirtualTextDocumentInteractions" class="anchor">External Virtual Text Document Interactions</a>

External virtual text document interactions can occur from several requests. The data types that are deemed "externally interactable" are: `WorkspaceEdit`, `Location` and `LocationLink`. The current methods that utilize these types are:

| Feature      | Method | Type | Direction |
| ------------ | ------------------------- | ---------- | ---------|
| Goto Declaration | textDocument/declaration | `Location[]` or `LocationLink[]` | client -> server |
| Goto Definition | textDocument/definition | `Location[]` or `LocationLink[]` | client -> server |
| Goto Type Definition | textDocument/typeDefinition | `Location[]` or `LocationLink[]` | client -> server |
| Goto Implementation | textDocument/implementation | `Location[]` or `LocationLink[]` | client -> server |
| Find References | textDocument/references | `LocationLink[]` | client -> server |
| Rename | textDocument/rename | `WorkspaceEdit` | client -> server |
| Apply Workspace Edit | workspace/applyEdit | `WorkspaceEdit` | server -> client |

When a client gets a response or a request (`workspace/applyEdit`) from one of these supported methods that implicate a virtual text document it's the clients responsibility to lookup that virtual text document's owner and perform translation requests prior to applying the results.

_Server Capability_:

- property name (optional): `workspace.virtualTextDocument`
- property type: `VirtualTextDocumentServerCapabilities` defined as follows:

```typescript
/**
 * Server capabilities specific to virtual text documents
 */
export interface VirtualTextDocumentServerCapabilities {
    /**
     * Whether the client supports translating externally sourced WorkspaceEdits on owned virtual text documents
     */
    workspaceEditOptions?: VirtualTextDocumentWorkspaceEditOptions;

    /**
     * Whether the client supports translating externally sourced Locations on owned virtual text documents
     */
    locationOptions?: VirtualTextDocumentLocationOptions;

    /**
     * Whether the client supports translating externally sourced LocationLinks on owned virtual text documents
     */
    locationLinkOptions?: VirtualTextDocumentLocationLinkOptions;
}

/**
 * Server capabilities specific to externally sourced WorkspaceEdit handling for virtual text documents
 */
export interface VirtualTextDocumentWorkspaceEditOptions {
}

/**
 * Server capabilities specific to externally sourced Location translation handling for virtual text documents
 */
export interface VirtualTextDocumentLocationOptions {
}

/**
 * Server capabilities specific to externally sourced LocationLink translation handling for virtual text documents
 */
export interface VirtualTextDocumentLocationLinkOptions {
}
```

### <a href="#workspaceEditTranslationRequest" name="workspaceEditTranslationRequest">WorkspaceEdit Translation Request</a>

_Server Capability_:
- property name (optional): `workspace.virtualTextDocument.workspaceEditOptions`
- property type: `VirtualTextDocumentWorkspaceEditOptions`

_Request_:
* method: `translate/workspaceEdit`
* params: `TranslateWorkspaceEditParams` defined as follows:

```typescript
interface TranslateWorkspaceEditParams {
    /**
     * The workspace edit to translate.
     */
    workspaceEdit: WorkspaceEdit;

    /**
     * The method that returned the provided workspace edit i.e. "textDocument/rename"
     */
    methodSource?: string;
}
```

_Response_:
* result: `WorkspaceEdit`

### <a href="#locationsTranslationRequest" name="locationsTranslationRequest">Locations Translation Request</a>

_Server Capability_:
- property name (optional): `workspace.virtualTextDocument.locationOptions`
- property type: `VirtualTextDocumentLocationOptions`

_Request_:
* method: `translate/locations`
* params: `TranslateLocationsParams` defined as follows:

```typescript
interface TranslateLocationsParams {
    /**
     * The locations to translate.
     */
    locations: Location[];

    /**
     * The method that returned the provided locations i.e. "textDocument/definition"
     */
    methodSource?: string;
}
```

_Response_:
* result: `Location[]`

### <a href="#locationLinksTranslationRequest" name="locationLinksTranslationRequest">Location Links Translation Request</a>

_Server Capability_:
- property name (optional): `workspace.virtualTextDocument.locationLinkOptions`
- property type: `VirtualTextDocumentLocationLinkOptions`

_Request_:
* method: `translate/locationLinks`
* params: `TranslateLocationLinksParams` defined as follows:

```typescript
interface TranslateLocationLinksParams {
    /**
     * The location links to translate.
     */
    locationLinks: LocationLink[];

    /**
     * The method that returned the provided location links i.e. "textDocument/reference"
     */
    methodSource?: string;
}
```

_Response_:
* result: `LocationLink[]`

# <a href="#openQuestions" name="openQuestions">Open questions</a>

- Is `workspace/applyEdit` the right method to manage document state? 
    - Initially I built out a mechanism for managing document state via custom virtualTextDocument/open/change/close requests ([sub-spec link](https://gist.github.com/NTaylorMullen/fa21ac3b30e621dc2b3d3f85dea62316)) where the `open` was a request and `change` and `close` were notifications. After deliberating pre-existing models for manipulating document content in the workspace (`workspace/applyEdit`) I fell back to the proven route; however, if the dynamic of open virtual text documents allow for change/close to be notifications that could be a highly beneficial approach.
- Should the top-level language server be controlling document versions after edit? Even in my [spec variant](https://gist.github.com/NTaylorMullen/fa21ac3b30e621dc2b3d3f85dea62316) I choose to not have it author the versions because technically the server should be controlling all of the document update requests which get put into queues ensuring that past or future sub-language versions don't really matter; servers always operate on the "latest".
- Is it reasonable for a client to make requests to translate locations and edits based off of the result of a previous request like `textDocument/rename`?
    - I considered having the translation be server initiated however I uncovered two problems with that approach:
        1. Servers would have to be virtual text document aware for any sort of translations to occur. This felt excessively restrictive given the sheer number of pre-existing language servers.
        1. If a server initiated a translate request could it actually provide reasonable information for others to react to? Aka, the act of renaming a symbol in one language is difficult for a language like Razor to understand. For instance in the above example regarding [additive external interactions](#additiveInteractionExample) I found that having a symbol helper class was the only way (without private APIs) for Razor to properly understand when an interesting symbol interaction occurred making it less meaningful for a server to even initiate the request. Try to do the additive external interactions example with a server initiated flow but no symbol helper C# file. I at least quickly ran into issues where the server would be doing a `translate/renameOperation` and trying to pass opaque parameters that don't necessarily mean that the server is renaming a pertinant symbol that the host language cares about.
- Why does VSCode not provide a platform API to delegate resolve based requests like `completionItem/resolve`? I imagine the intent was because VSCode doesn't know which server cares about the `completionItem`, is this solveable? I found [this thread](https://github.com/microsoft/vscode/issues/44846) where the completion item provider APIs can take in a number of items to auto-resolve; however, this is less than ideal. In VS all language servers get asked to resolve a completion item and most no-op if they can't do anything or don't recognize it.
- What in the world is the `vscode.provideDocumentRangeSemanticTokensLegend` VSCode command?
- lol why'd I even write this section? Everything is an open question :tada: :rofl: :tada:
