from django.http import JsonResponse
from django.urls import path


def verdict(request):
    # request.botscent is what this request itself declared. The stale botscent entry
    # stands in for one a cache might replay; the middleware removes it.
    response = JsonResponse({"verdict": request.botscent, "bytes": len(request.body)})
    response["Server-Timing"] = 'botscent;desc="1;chatgpt;1;signer.web-bot-auth.verified", app;dur=1'
    return response


urlpatterns = [path("verdict", verdict)]
