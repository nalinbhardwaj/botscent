"""The smallest Django project with the server half: one line in MIDDLEWARE.

The site runs at the origin, which cannot see whether a CDN in front of it stores
HTML, so the Server-Timing transport is off unless BOTSCENT_TRANSPORT = True."""

SECRET_KEY = "example-only"
DEBUG = False
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
ROOT_URLCONF = "example.urls"
MIDDLEWARE = ["botscent.django.BotscentMiddleware"]
