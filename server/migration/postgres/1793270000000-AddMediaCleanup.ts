import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaCleanup1793270000000 implements MigrationInterface {
  name = 'AddMediaCleanup1793270000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "media" ADD "cleanup" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "media" DROP COLUMN "cleanup"`);
  }
}
