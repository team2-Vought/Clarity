import io
import zipfile
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from discussions.models import Attachment
from discussions.services import attachments
from discussions.services.usage import today

from .fakes import FakeProvider

User = get_user_model()

def pdf(content):
    """Найпростіший коректний PDF: одна сторінка з потоком `content` і таблицею xref."""
    stream = content.encode('latin-1')
    objects = [
        b'<</Type/Catalog/Pages 2 0 R>>',
        b'<</Type/Pages/Kids[3 0 R]/Count 1>>',
        b'<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R'
        b'/Resources<</Font<</F1 5 0 R>>>>>>',
        b'<</Length %d>>stream\n' % len(stream) + stream + b'\nendstream',
        b'<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    ]
    out = bytearray(b'%PDF-1.4\n')
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b'%d 0 obj' % number + body + b'endobj\n'
    xref = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objects) + 1)
    out += b''.join(b'%010d 00000 n \n' % offset for offset in offsets)
    out += b'trailer<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF' % (len(objects) + 1, xref)
    return bytes(out)


PDF = pdf('BT /F1 18 Tf 20 100 Td (Salary 3000 USD per month) Tj ET')
# сторінка лише з лінією — як скан без текстового шару
EMPTY_PDF = pdf('0 0 m 100 100 l S')


def docx(*paragraphs):
    body = ''.join(
        f'<w:p><w:r><w:t>{text}</w:t></w:r></w:p>' for text in paragraphs
    )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:body>{body}</w:body></w:document>'
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr('word/document.xml', xml)
    return buffer.getvalue()


class VisionProvider:
    def __init__(self):
        self.images = []

    def complete_image(self, *, system, prompt, image, mime):
        self.images.append((mime, len(image)))
        return 'ОГОЛОШЕННЯ\nОренда: 18 000 грн\nКомуналка окремо'


@override_settings(DISCUSSION_RUNNER_SYNC=True)
class AttachmentApiTests(TestCase):
    def setUp(self):
        throttle = mock.patch(
            'rest_framework.throttling.SimpleRateThrottle.allow_request', return_value=True
        )
        throttle.start()
        self.addCleanup(throttle.stop)
        self.provider = FakeProvider()
        provider = mock.patch(
            'discussions.services.engine.calls.get_provider',
            side_effect=lambda model_id: self.provider,
        )
        provider.start()
        self.addCleanup(provider.stop)
        self.client = APIClient()
        self.user = User.objects.create_user(email='files@test.com', name='Оксана', password='pass123!A')
        self.client.force_authenticate(self.user)

    def upload(self, name, data, content_type='application/octet-stream'):
        return self.client.post(
            '/api/attachments/',
            {'file': SimpleUploadedFile(name, data, content_type=content_type)},
            format='multipart',
            HTTP_ACCEPT_LANGUAGE='uk',
        )

    def test_text_file_is_read(self):
        response = self.upload('offer.txt', 'Зарплата: 3000$\n\n\n\nВідпустка 24 дні'.encode('cp1251'))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['kind'], 'text')
        self.assertEqual(Attachment.objects.get().text, 'Зарплата: 3000$\n\nВідпустка 24 дні')
        self.assertIn('Зарплата', response.data['preview'])

    def test_word_document_is_read(self):
        response = self.upload('contract.docx', docx('Договір оренди', 'Строк: 11 місяців'))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['kind'], 'docx')
        self.assertEqual(Attachment.objects.get().text, 'Договір оренди\nСтрок: 11 місяців')

    def test_pdf_text_is_read(self):
        response = self.upload('offer.pdf', PDF, 'application/pdf')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIn('Salary 3000 USD', Attachment.objects.get().text)

    def test_scanned_pdf_asks_for_photos(self):
        response = self.upload('scan.pdf', EMPTY_PDF, 'application/pdf')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'scanned')

    def test_unsupported_and_too_large_files(self):
        self.assertEqual(self.upload('song.mp3', b'ID3').data['code'], 'unsupported')
        with mock.patch.object(attachments, 'MAX_BYTES', 4):
            self.assertEqual(self.upload('notes.txt', b'12345').data['code'], 'too_large')

    def test_photo_without_a_vision_model_explains_what_to_do(self):
        with mock.patch('discussions.services.attachments.vision_model_ids', return_value=[]):
            response = self.upload('flat.jpg', b'\xff\xd8fake', 'image/jpeg')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'no_vision')
        self.assertIn('Моделі й ключі', response.data['detail'])

    def test_photo_is_transcribed_by_a_vision_model(self):
        vision = VisionProvider()
        with (
            mock.patch('discussions.services.attachments.vision_model_ids', return_value=['groq:qwen/qwen3.8-27b']),
            mock.patch('discussions.services.attachments.get_provider', return_value=vision),
        ):
            response = self.upload('flat.jpg', b'\xff\xd8fake', 'image/jpeg')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['kind'], 'image')
        self.assertEqual(vision.images[0][0], 'image/jpeg')
        self.assertIn('18 000 грн', Attachment.objects.get().text)
        self.assertEqual(today(self.user).replies, 1)

    def create(self, attachment_ids):
        response = self.client.post(
            '/api/discussions/',
            {
                'question': 'Чи варто погоджуватись на цей оффер?',
                'personas': ['logician', 'skeptic'],
                'attachments': attachment_ids,
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_documents_reach_every_prompt_but_not_the_shared_link(self):
        attachment_id = self.upload('offer.txt', 'Зарплата: 3000$ на місяць'.encode()).data['id']
        created = self.create([str(attachment_id)])
        self.assertEqual(created['attachments'][0]['name'], 'offer.txt')
        self.assertNotIn('text', created['attachments'][0])

        self.client.post(f'/api/discussions/{created["id"]}/run/')
        prompts_seen = [call['prompt'] for call in self.provider.calls]
        self.assertTrue(prompts_seen)
        for prompt in prompts_seen:
            self.assertIn('<document name="offer.txt">', prompt)
            self.assertIn('Зарплата: 3000$ на місяць', prompt)
        self.assertIn('Не питай про те, що є в документах', prompts_seen[0])

        token = self.client.post(f'/api/discussions/{created["id"]}/share/').data['share_token']
        shared = APIClient().get(f'/api/shared/{token}/')
        self.assertNotIn('3000$', str(shared.data))

    def test_only_own_unattached_files_can_be_added_or_removed(self):
        stranger = User.objects.create_user(email='x@test.com', name='Інший', password='pass123!A')
        foreign = Attachment.objects.create(user=stranger, name='a.txt', kind='text', size=1, text='чуже')
        created = self.create([str(foreign.pk)])
        self.assertEqual(created['attachments'], [])

        mine = self.upload('a.txt', b'text').data['id']
        self.create([str(mine)])
        self.assertEqual(self.client.delete(f'/api/attachments/{mine}/').status_code, 404)
        loose = self.upload('b.txt', b'text').data['id']
        self.assertEqual(self.client.delete(f'/api/attachments/{loose}/').status_code, 204)

    def test_long_documents_share_the_prompt_budget(self):
        items = [Attachment(name=f'{i}.txt', text='слово ' * 5000) for i in range(3)]
        with override_settings(ATTACHMENTS_PROMPT_CHARS=6000):
            docs = attachments.documents_for_prompt(items)
        self.assertEqual(len(docs), 3)
        for _, text in docs:
            self.assertTrue(text.endswith('[…]'))
            self.assertLessEqual(len(text), 2010)

    def test_too_many_files(self):
        ids = [str(self.upload(f'{i}.txt', b'text').data['id']) for i in range(4)]
        response = self.client.post(
            '/api/discussions/',
            {'question': 'Чи варто погоджуватись?', 'personas': ['logician', 'skeptic'], 'attachments': ids},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('attachments', response.data)

    def test_files_added_to_a_follow_up_reach_the_next_prompts(self):
        created = self.create([])
        self.client.post(f'/api/discussions/{created["id"]}/run/')
        attachment_id = self.upload('lease.txt', 'Оренда: 18 000 грн'.encode()).data['id']
        response = self.client.post(
            f'/api/discussions/{created["id"]}/messages/',
            {'content': 'Ось договір оренди', 'attachments': [str(attachment_id)]},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['message']['attachments'][0]['name'], 'lease.txt')
        self.assertIn('<document name="lease.txt">', self.provider.calls[-1]['prompt'])

        # у самому питанні файла немає — він при своєму уточненні
        detail = self.client.get(f'/api/discussions/{created["id"]}/').data
        self.assertEqual(detail['attachments'], [])
        note = next(m for m in detail['messages'] if m['content'] == 'Ось договір оренди')
        self.assertEqual(note['attachments'][0]['name'], 'lease.txt')

        token = self.client.post(f'/api/discussions/{created["id"]}/share/').data['share_token']
        shared = APIClient().get(f'/api/shared/{token}/')
        self.assertNotIn('lease.txt', str(shared.data))

    def test_a_discussion_holds_a_limited_number_of_files(self):
        ids = [str(self.upload(f'{i}.txt', b'text').data['id']) for i in range(3)]
        created = self.create(ids)
        more = [str(self.upload(f'more{i}.txt', b'text').data['id']) for i in range(2)]
        with override_settings(ATTACHMENTS_TOTAL_MAX=4):
            response = self.client.post(
                f'/api/discussions/{created["id"]}/messages/',
                {'content': 'Ще файли', 'attachments': more},
                format='json',
            )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'attachments_limit')
        self.assertEqual(Attachment.objects.filter(discussion__isnull=True).count(), 2)
