from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import RegisterSerializer, create_user


class RegisterView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = create_user(serializer.validated_data)
        return Response(
            {
                'detail': 'Реєстрацію успішно завершено',
                'user': {
                    'id': user.id,
                    'name': user.name,
                    'email': user.email,
                },
            },
            status=status.HTTP_201_CREATED,
        )
