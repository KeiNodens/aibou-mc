# ProjectE Integration 7.2.5 — layer-3 notes (AI consumer)

Provenance: TagnumElite/ProjectE-Integration, branch
1.20.x tip, commit 8ea22bc9ea940180f1bcbedd2197456512f2e1e2
(gradle.properties at this commit declares mod_version
7.2.5). Values file: projecte_integration@7.2.5.json.
Fuller notes, including how this interacts with
ProjectExpansion, are in projectexpansion@1.1.3.md.

Summary: this addon contributes no EMC numbers of its
own. It registers recipe-type mappers for 27 mods so
ProjectE's graph mapper can price their items; 9 of those
mods are in this pack. All value questions still resolve
through the base ProjectE model (projecte rule file,
D52): seeds plus recipe graph, datapack overrides win.
