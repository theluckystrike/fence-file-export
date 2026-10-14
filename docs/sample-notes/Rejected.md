# Check the rejected paths

A valid file can be created beside these rejected blocks.

```text file="README.txt"
This output stays inside the chosen vault folder.
```

```text file="../private.txt"
This path leaves the selected folder.
```

> ```python file="nested.py"
> print("A quoted block is unsupported")
> ```

```text file=".hidden/config.txt"
Hidden targets are excluded.
```
