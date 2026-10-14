# One file from two blocks

The imports and program body share main.py.

```python file="main.py"
from pathlib import Path
```

```python file="main.py"
def list_notes(folder):
    return sorted(Path(folder).glob("*.md"))

print(list_notes("Notes"))
```
