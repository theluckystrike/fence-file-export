# Small service recipe

Keep the source and its configuration in this note. Export to a new folder after review.

```python file="main.py"
def greeting(name):
    return f"Hello, {name}"

print(greeting("reader"))
```

~~~yaml file="config/app.yml"
service:
  name: sample-service
  port: 8080
~~~~
