# Shared in-memory job storage.
# All routers read/write this dict to avoid tight coupling.
jobs: dict = {}
