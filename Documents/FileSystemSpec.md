# Expanding LSP to Support Virtual File Systems

This document details a solution to creating virtual file systems in a platform agnostic way. It sits ontop of the pre-existing [language server protocol (LSP)](https://microsoft.github.io/language-server-protocol/specification), utilizing the groundwork it has laid out while building out what it means to have a general "tooling server".

## Table of Contents

- [Problem Background](#problemBackground)
- [Solution](#solution)
    - [Spec](#spec)
- [LSP Spec Expansion](#specExpansion)

# <a href="#problemBackground" name="problemBackground">Problem Background</a>

A virtual file system can represent remote places like ftp-servers, help power embedded languages or even describe mainstream project exporers where not everything is "real". The movement to build tooling that spans ecosystems or even crosses boundaries (remote development) has proven to be difficult. Trying to generically solve the problem of how to show or maintain a virtual file system has been a delicate road of balancing fragility, dev resources and robustness. Some concrete examples today that dance along these problem boundaries are:

- LiveShare & Codespaces
- Solution/Project Explorer
- Folder explorers
- Embedded languages such as Razor, PHP, HTML etc.
- FTP

Now virtual file systems aren't entirely new. VSCode recently built out a model to enable extenders to bring their own file systems in the form of [`FileSystemProvider`](https://code.visualstudio.com/api/references/vscode-api#FileSystemProvider)s. Because of their precedent the ideas presented in this document are heavily influenced by their design and are meant to standardize what it means for a tooling server to bring its own file system for any level of use.

# <a href="#solution" name="solution">Solution</a>

The virtual file system spec sits ontop of LSP's [Base Protocol](https://microsoft.github.io/language-server-protocol/specifications/specification-current/#headerPart) and versioning while also expanding its [General Messages](https://microsoft.github.io/language-server-protocol/specifications/specification-current/#initialize) for negoatiating client/server capabilities. The intent is that it's possible to have a pure tooling server or even a language server that has file system capabilities.

The spec adds descriptive APIs to enable clients to query information of a virtual file system in order to retrieve, mutate or display content.

## <a href="#spec" name="spec">Spec</a>



