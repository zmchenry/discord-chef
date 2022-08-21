import json
import requests
import os
import notion_client
from constants import PAGE_FOR_WEEKDAY
from utils import debug

WHEN_ATTRIBUTE_ID = "%5CP%22-"

class NotionClient():
    def __init__(self):
        self.NOTION_TOKEN = os.getenv('NOTION_KEY')
        self.NOTION_DB = os.getenv('NOTION_DB_ID')
        self.notion = notion_client.Client(auth=self.NOTION_TOKEN)

        self.HEADERS = {
            "Accept": "application/json",
            "Notion-Version": "2022-02-22",
            "Content-Type": "application/json",
            "Authorization": "Bearer {token}".format(token = self.NOTION_TOKEN)
        }

    # Query a specific Notion table specified by db_id
    # with filter information specified by payload
    def query_table(self, db_id, payload):
        url = "https://api.notion.com/v1/databases/{id}/query".format(id = db_id)

        response = requests.post(url, json=payload, headers=self.HEADERS)

        return json.loads(response.text)

    # Get all the registered recipes in Notion
    def query_recipes(self):
        print(f'Getting recipes currently in the table')
        return self.query_table(self.NOTION_DB, {})

    # Get all recipes which are scheduled for a specific day
    def query_planned_meals(self):
        print(f'Attempting to query Notion for planned meals')
        or_filter = []
        for value in list(PAGE_FOR_WEEKDAY.keys()):
            or_filter.append({
                "property": "When",
                "relation": {"contains": value}
            })

        payload = {
            "page_size": 25,
            "filter": {
                "or": or_filter
            }
        }

        meal_table = self.query_table(self.NOTION_DB, payload)
        print(f'Planned meals retrieval successful, returning planned meals')
        return meal_table

    # Update a Recipe with the designated day
    def update_recipe_with_day(self, recipe_id: str, day_id):
        url = "https://api.notion.com/v1/pages/{id}".format(id=recipe_id)

        body = {
            "properties": {
                WHEN_ATTRIBUTE_ID: {
                    "relation": day_id
                }
            }
        }

        response = requests.patch(url, json=body, headers=self.HEADERS)
        
        return response.status_code